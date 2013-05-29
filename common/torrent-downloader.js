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
  , xmlrpc = require('xmlrpc')
;

var errorCodes = module.exports.errorCodes = {
  'malformedURI': 'MALFORMEDURI',
  'malformedMagnetURI': 'MALFORMEDMAGNETURI',
  'torrentFileDownloadError': 'TORRENTFILEDOWNLOADERROR',
  'downloadComplete': 'DOWNLOADCOMPLETE',
  'downloadError': 'DOWNLOADERROR'
}

var RPCHOST = '192.168.1.10';
var RPCPORT = 80
var POLLDELAY = 30;

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
  var options = {
    host: RPCHOST,
    port: RPCPORT,
    path: '/RPC2'
  };

  this.client = xmlrpc.createClient(options);
  this.enablePoll = true;

  this._init();
};

TorrentDownloader.prototype._init = function () {
  var self = this;

  self.enablePoll = true;
  self.poll(); // starts the polling cycle running
};

TorrentDownloader.prototype.poll = function () {
  var self = this;
  var promiseAccumulator = []

  // we want to accumulate all our promises so that we don't accidentally hammer xmlRPC, 
  // we can just wait for all the promises to resolve before queing another poll

  var pGetTorrents = self.getTorrents();
  pGetTorrents.then(self.handleTorrentList);
  promiseAccumulator.push(pGetTorrents)

  Promise.allOrNone(promiseAccumulator).then(function queueNewPoll() {
    // poll ready to be queued up again
    if (!self.enablePoll) { return; }
    self.poll.delay(POLLDELAY * 1000);

  }, function pollError(err) {
    logger.error('Error during poll: %s', err.message);
    self.enablePoll = false;
  });
};

TorrentDownloader.prototype.callMethod = function () {
  // simple wrapper around xmlrpc so we get a promise return
  // we need to bind the client.callMethod to use client as its this
  // javascript is annoying.
  var fn = this.client.callMethod.bind(this.client);
  var args = Array.prototype.slice.call(arguments, 1);
  args.unshift(fn);

  if (args.length < 3) { // lets us do some shorthand if no paramaters are passed 
    args.push([]);
  }

  // Promise.execute creates a promise for us, but we can be a bit smarter and 
  // create our own promise that we can reject/resolve depending on the error value returned
  var promise = Promise.Promise();
  Promise.execute.call(args).then(function (err, val) {
    if (!!err) { 
      promise.reject(err, val);
    }
    else {
      promise.resolve(val);
    }
  });

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
  var promise = Promise.Promise();

  self.callMethod('download_list').then(function onDownloadListReturned(val) {
    promise.resolve(val);
  }, self.genericFailure(promise));

  return promise;
};

/* Handlers */
TorrentDownloader.prototype.handleTorrentList = function (val) {
  logger.info('HandleTorrentList: %s', val);
};

TorrentDownloader.prototype.addFromURI = function (downloadDir, URI) {
  var promise = Promise.Promise();
  var self = this;

  var torrent = this.client.addTorrent(URI, downloadDir);

  torrent.on('complete', function () {
    promise.resolve(torrent.files);
    self.client.removeTorrent(torrent);
  });

  torrent.on('error', function (error) {
    promise.reject(error);
    self.client.removeTorrent(torrent);
  });

  return promise;
};

module.exports.addFromURI = function (uri, downloadDir) {
  //TODO!! - add uri checks before sending to torrent downloader
  var check = null; // check go here
  if (check) {
    var promise = Promise.Promise();
    var error = new Error(errorCodes.malformedURI);
    error.detail = check;
    promise.reject([error, null]);
    return promise;
  }
  else {
    return getTorrentDownloader().addFromURI(uri, downloadDir);
  }
};


