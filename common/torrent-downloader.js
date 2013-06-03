"use strict";
/*jslint white: true */
/*
 * torrent-downloader: downloads torrents?
 *
 * (C) 2012 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , Promise = require('node-promise')
  , events = require('events')
  , logger = acquire('logger').forFile('torrent-downloader.js')
  , util = require('util')
  , path = require('path')
  , os = require('os')
  , utilities = acquire('utilities')
  , xmlrpc = require('xmlrpc')
  , XRegExp = require('xregexp').XRegExp
;

var errorCodes = module.exports.errorCodes = {
  'malformedURI': 'MALFORMEDURI',
  'malformedMagnetURI': 'MALFORMEDMAGNETURI',
  'torrentFileDownloadError': 'TORRENTFILEDOWNLOADERROR',
  'downloadComplete': 'DOWNLOADCOMPLETE',
  'downloadError': 'DOWNLOADERROR'
}

var EXTRADEBUG = true; // if this is on in a merge request, yell at me. 

var RPCHOST = '192.168.1.10';
var RPCPORT = 80
var POLLDELAY = 5;
var magnetMatch = XRegExp('xt=urn:btih:(?<infohash>[0-9a-h]+)', 'gix'); // global, ignore case, free spacing 

function trace() {
  if (!EXTRADEBUG) return;
  var args = Array.prototype.slice.call(arguments, 1);
  var formatStr = arguments[0];
  args.unshift('[trace] ' + formatStr);

  logger.info.apply(logger, args);
}

function genRandString(size) {
  if (!size) { size = 8; }
  var pool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
  var val = "";
  while (val.length < size) {
    val += pool.charAt(Math.floor(Math.random() * pool.length));
  };
  return val;
}

var globalTorrentDownloader = null; // stays consistant over multiple imports as long as nodes import caching isn't broken
function getTorrentDownloader() {
  // returns torrent downloader if it exists, otherwise creates it
  if (!globalTorrentDownloader) { globalTorrentDownloader = new TorrentDownloader(); }
  return globalTorrentDownloader;
}

var TorrentDownloader = function () {
  this.downloadPath = path.join(os.tmpdir(), genRandString());
  this._init();
};

TorrentDownloader.prototype._init = function () {
  var self = this;
  var options = {
    host: RPCHOST,
    port: RPCPORT,
    path: '/RPC2'
  };
  self.client = xmlrpc.createClient(options);
  
  self.watchHashes = {};

  self.enablePoll = true;
  self.poll(); // starts the polling cycle running
};

TorrentDownloader.prototype.poll = function () {
  var self = this;
  var promiseAccumulator = []

  // we want to accumulate all our promises so that we don't accidentally hammer xmlRPC, 
  // we can just wait for all the promises to resolve before queing another poll

  var pGetTorrents = self.getTorrents();
  pGetTorrents.then(self.handleTorrentList.bind(self));
  promiseAccumulator.push(pGetTorrents)

  Promise.allOrNone(promiseAccumulator).then(function queueNewPoll() {
    // poll ready to be queued up again
    if (!self.enablePoll) { return; }
    self.poll.bind(self).delay(POLLDELAY * 1000);

  }, function pollError(err) {
    logger.error('Error during poll: %s', err.message);
    self.enablePoll = false;
  });
};

var methodID = 0;
TorrentDownloader.prototype.callMethod = function () {
  var self = this;
  methodID++;

  var promise = new Promise.Promise();
  // simple wrapper around xmlrpc so we get a promise return
  
  var args = Array.prototype.slice.call(arguments, 1);
  var methodName = arguments[0];

  trace('(%d)calling method:\t %s(%s)', methodID, methodName, args);

  // create our promise handling callback function
  function handler(err, val) {
    if (!!val) {
      if (val.length) { trace('(%d)method return(%s): ' + val, methodID, methodName) } ;
    }

    if (!!err) {
      promise.reject(err, val);
    }
    else {
      promise.resolve(val);
    }
  };

  self.client.methodCall.apply(self.client, [methodName, args, handler]);

  return promise;
}

// builds an error handler for a promise 
TorrentDownloader.prototype.genericFailure = function (p) {
  function onError(promise, err) {
    promise.reject(err);
    logger.error("Error encountered: %s", err.message);
  }
  return onError.bind(this, p);
}

// returns a promise that will resolve to a list of torrents
TorrentDownloader.prototype.getTorrents = function () {
  var self = this;
  var promise = new Promise.Promise();

  self.callMethod('d.multicall', 'main', 'd.name=', 'd.hash=', 'd.size_bytes=', 'd.bytes_done=', 'd.is_open=').then(function onDownloadListReturned(val) {
    promise.resolve(val);
  }, self.genericFailure(promise));

  return promise;
};

TorrentDownloader.prototype.addInfohashToWatch = function (infohash) {
  var self = this;
  var promise = new Promise.Promise();
  var info = {
    name: "",
    hash: infohash,
    size: 1,
    progressSize: 0,
    state: null,
    'promise': promise
  };

  if (Object.has(self.watchHashes, infohash)) { promise.reject(new Error('infohash ' + infohash + 'already added')); return promise; }
  self.watchHashes[infohash] = info;
  return promise;
}

// infohash, can send in as many values as you want after info hash, they will be passed on
TorrentDownloader.prototype.resolveInfohash = function (infohash) {
  var self = this;
  if (!Object.has(self.watchHashes, infohash)) { logger.error('could not find infohash %s to resolve', infohash); return; }

  var args = Array.prototype.slice.call(arguments, 1);
  self.watchHashes[infohash].promise.resolve.apply(self.watchHashes[infohash], args);
  delete self.watchHashes[infohash];
}

TorrentDownloader.prototype.rejectInfohash = function (infohash) {
  var self = this;
  if (!Object.has(self.watchHashes, infohash)) { logger.error('could not find infohash %s to reject', infohash); return; }

  var args = Array.prototype.slice.call(arguments, 1);
  self.watchHashes[infohash].promise.reject.apply(self.watchHashes[infohash], args);
  delete self.watchHashes[infohash];
}

TorrentDownloader.prototype.rejectInfohashBuilder = function (infohash) {
  return this.rejectInfohash.bind(this, infohash);
}

/* Handlers */
TorrentDownloader.prototype.handleTorrentList = function (val) {
  var self = this;

  val.every(function onEachTorrent(torrentInfo) {
    var info = {
      name: torrentInfo[0],
      hash: torrentInfo[1],
      size: torrentInfo[2],
      progressSize: torrentInfo[3],
      state: torrentInfo[4]
    };

    if (Object.has(self.watchHashes, info.hash)) {
      self.torrentUpdate(info);
    }
    else {
      logger.warn('Torrent polled that we are not watching: %s (%s)', info.name, info.hash);
      logger.warn('Removing torrent %s (%s)', info.name, info.hash);
      self.callMethod('d.erase', info.hash);
    }
  });
};

TorrentDownloader.prototype.torrentUpdate = function (info) {
  var self = this;
  var hash = info.hash;

  self.watchHashes[hash] = Object.merge(self.watchHashes[hash], info);
  var progress = self.watchHashes[hash].progressSize / self.watchHashes[hash].size;

  // make sure we didn't get a closed state on a torrent somehow, ensuring states sucks
  console.log(info.state);
  if (info.state.has('0')) {
    self.callMethod('d.start', hash);
  }

  if (self.watchHashes[hash].progressSize < self.watchHashes[hash].size) {
    // torrent not complete
    var progress = self.watchHashes[hash].progressSize / (self.watchHashes[hash].size / 100);
    logger.info('torrent progress (%d%%):\t %s', progress, self.watchHashes[hash].name);
  }
  else {
    // torrent complete
    logger.info(self.watchHashes[hash].progressSize, self.watchHashes[hash].size);
    logger.info('torrent complete:\t %s', self.watchHashes[hash].name);
    self.callMethod('d.erase', hash).then(function () {
      self.resolveInfohash(hash);
    });
  }
}

TorrentDownloader.prototype.addFromURI = function (downloadDir, URI) {
  var promise = new Promise.Promise();
  var self = this;

  //only support magnet for right now, easier to extract the infohash
  if (!URI.has('magnet:')) { promise.reject(new Error('only magnet links supported')); return promise; }
  var match = XRegExp.exec(URI, magnetMatch);
  if (!match.infohash) { promise.reject(new Error('could not extract infohash from magnet URI: ' + URI)); return promise; }

  var infohash = match.infohash;
  logger.info('Extracted %s infohash', infohash);

  self.addInfohashToWatch(infohash.toUpperCase()).then(function () { promise.resolve.apply(promise, arguments); },
                               function () { promise.reject.apply(promise, arguments); })

  // i miss seleniums promise manager, must build one of those some day
  self.callMethod('load', [URI]).then(function () {
    self.callMethod('d.set_directory', infohash, downloadDir).then(function () {
      self.callMethod('d.start', infohash).then(function () {
        self.callMethod('d.open', infohash);
      });
    });
  }, self.rejectInfohashBuilder(infohash));
 

  return promise;
};

module.exports.addFromURI = function (uri, downloadDir) {
  //TODO!! - add uri checks before sending to torrent downloader
  var check = null; // check go here
  if (check) {
    var promise = new Promise.Promise();
    var error = new Error(errorCodes.malformedURI);
    error.detail = check;
    promise.reject([error, null]);
    return promise;
  }
  else {
    return getTorrentDownloader().addFromURI(uri, downloadDir);
  }
};


// for testing
if (require.main === module) {
  var tDownloder = getTorrentDownloader();
  tDownloder.addFromURI("/tmp/", "magnet:?xt=urn:btih:335990d615594b9be409ccfeb95864e24ec702c7&dn=Ubuntu+12.10+Quantal+Quetzal+%2832+bits%29&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A6969&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337");
  //tDownloder.addFromURI("/tmp/", "magnet:?xt=urn:btih:786e6bac12504ada2db0054fe375c3912c2af249&dn=beini-1.2.3.zip&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A6969&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337");
}