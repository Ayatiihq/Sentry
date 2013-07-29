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
  , config = acquire('config')
  , Promise = require('node-promise')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('torrent-downloader.js')
  , util = require('util')
  , path = require('path')
  , os = require('os')
  , utilities = acquire('utilities')
  , readtorrent = require('read-torrent')
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

var EXTRADEBUG = false; // if this is on in a merge request, yell at me. 

var RPCHOST = config.RTORRENT_HOST;
var RPCPORT = config.RTORRENT_PORT;
var POLLDELAY = 5;
var magnetMatch = XRegExp('xt=urn:btih:(?<infohash>[0-9a-h]+)[$&]', 'gix'); // global, ignore case, free spacing 
var MAXNOPROGRESSTIME = 10 * 60;

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
  self.waitUntilFoundList = {};

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
    lastProgressTime: process.hrtime(),
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
  val.each(function onEachTorrent(torrentInfo) {
    var info = {
      name: torrentInfo[0],
      hash: torrentInfo[1],
      size: parseInt(torrentInfo[2], 10),
      progressSize: parseInt(torrentInfo[3], 10),
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

  if (self.watchHashes[hash].progressSize !== info.progressSize) {
    self.watchHashes.lastProgressTime = process.hrtime();
  }

  self.watchHashes[hash] = Object.merge(self.watchHashes[hash], info);
  var progress = self.watchHashes[hash].progressSize / self.watchHashes[hash].size;

  // wait until found support
  if (!!self.waitUntilFoundList[hash]) {
    self.waitUntilFoundList[hash].each(function (p) { p.resolve(hash); });
    self.waitUntilFoundList[hash] = [];
  }

  // make sure we didn't get a closed state on a torrent somehow, ensuring states sucks

  if (info.state.has('0')) {
    self.callMethod('d.start', hash);
  }

  // do a check on the torrent progress, if it has been more than x seconds since the last time it 'moved'
  // just reject it
  // FIXME - in the future lets be smarter? i'm not entirely sure where rtorrent falls down though so need that infos
  // before we can do anything interesting. 
  var lastTime = process.hrtime(self.watchHashes[hash].lastProgressTime)[0];
  if (lastTime > MAXNOPROGRESSTIME) {
    logger.warn('Torrent has not progressed in %s seconds, cancelling: %s', lastTime, self.watchHashes[hash].name);
    self.callMethod('d.erase', hash).then(function () {
      self.rejectInfohash(hash, new Error('Torrent has not progressed in ' + lastTime + ' seconds'));
    });

    return;
  }

  if (self.watchHashes[hash].progressSize < self.watchHashes[hash].size) {
    // torrent not complete
    var progress = self.watchHashes[hash].progressSize / (self.watchHashes[hash].size / 100);
    trace('torrent progress (%d%%):\t %s', progress, self.watchHashes[hash].name);
  }
  else {
    // torrent complete
    logger.info('torrent complete:\t %s', self.watchHashes[hash].name);
    self.callMethod('d.erase', hash).then(function () {
      self.resolveInfohash(hash);
    });
  }
}

TorrentDownloader.prototype.getNumActiveTorrents = function () {
  return Object.keys(this.watchHashes).length;
};

TorrentDownloader.prototype.getURIHash = function (URI) {
  var promise = new Promise.Promise();

  if (URI.has('magnet:')) {
    // magnet uri we can do quickly
    var match = XRegExp.exec(URI, magnetMatch);
    if (!match) { URI = decodeURIComponent(URI); match = XRegExp.exec(URI, magnetMatch); }
    if (!match) { promise.reject(new Error('Can not understand URI: ' + URI)); return promise; }
    if (!match.infohash) { promise.reject(new Error('could not extract infohash from magnet URI: ' + URI)); return promise; }

    var infohash = match.infohash.toUpperCase();
    promise.resolve(infohash);
  }
  else {
    // other uri, we need to download the .torrent file, extract the hash ourselves then return it. kind of a pain
    // we need to download the torrent to a file on the filesystem to do this because readtorrent can't handle forced compression
    // and our own requestURL method doesn't return buffers.

    utilities.request(URI, {returnBuffer:true}, function onRequestFinish(err, response, body) {
      if (!!err) { promise.reject(err); }
      else if (response.statusCode >= 400 && response.statusCode < 500) {
        promise.reject(new Error('404: ' + URI));
      }
      else {
        readtorrent(body, function onReadTorrentFinished(err, result) {
          if (!!err) { promise.reject(err); }
          else { promise.resolve(result.infoHash.toUpperCase()); }
        });
      }
    });
  }

  return promise;
}

// returns a promise that will resolve when the info hash is found 
TorrentDownloader.prototype.waitUntilFound = function (infohash) {
  var self = this;
  var promise = new Promise.Promise();
  if (!Object.has(self.waitUntilFoundList, infohash)) {
    self.waitUntilFoundList[infohash] = [];
  }

  self.waitUntilFoundList[infohash].push(promise);

  return promise;
}

// given a URI will return a promise, if this uri is succesfully added to the backend
// then that promise will resolve to another promise that can be used to track the download.
// otherwise it is rejected, usually because its a .torrent that 404'ed
TorrentDownloader.prototype.addFromURI = function (downloadDir, URI) {
  var promise = new Promise.Promise();
  var self = this;

  self.getURIHash(URI).then(function onHashFound(infohash) {
    trace('Extracted %s infohash', infohash);
    var newPromise = self.addInfohashToWatch(infohash);

    // i miss seleniums promise manager, must build one of those some day
    self.callMethod('load', URI);

    // wait until we find the infohash of this torrent in rtorrent, then tell it to set a directory and start
    self.waitUntilFound(infohash).then(function () {
      self.callMethod('d.set_directory', infohash, downloadDir).then(function () {
        self.callMethod('d.start', infohash).then(function () {
          self.callMethod('d.open', infohash);
        });
      });
    }, self.rejectInfohashBuilder(infohash));

    promise.resolve(newPromise);
  },
  function onHashFindError(err) {
    promise.reject(err);
  });

  return promise;
};

module.exports.getNumActiveTorrents = function () {
  return getTorrentDownloader().getNumActiveTorrents();
}

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
  tDownloder.addFromURI("/tmp/dl", "magnet:?xt=urn:btih:335990d615594b9be409ccfeb95864e24ec702c7&dn=Ubuntu+12.10+Quantal+Quetzal+%2832+bits%29&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A6969&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337");
  //tDownloder.addFromURI("/tmp/", "magnet:?xt=urn:btih:786e6bac12504ada2db0054fe375c3912c2af249&dn=beini-1.2.3.zip&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A6969&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337");
}