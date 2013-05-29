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
  , torrentClient = require('node-torrent')
  , path = require('path')
  , os = require('os')
;

var errorCodes = module.exports.errorCodes = {
  'malformedURI': 'MALFORMEDURI',
  'malformedMagnetURI': 'MALFORMEDMAGNETURI',
  'torrentFileDownloadError': 'TORRENTFILEDOWNLOADERROR',
  'downloadComplete': 'DOWNLOADCOMPLETE',
  'downloadError': 'DOWNLOADERROR'
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
  this.tempdir = path.join(os.tmpdir(), genRandString());
  var options = { 'downloadPath': this.tempdir };
  this.client = new torrentClient(options);
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


