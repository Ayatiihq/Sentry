/*
 * downloader-torrent.js: the downloader-torrent
 *
 * (C) 2012 Ayatii Limited
 *
 * DownloaderTorrent is a specialized role to download data that can only be
 * accessed via Bittorrent.
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('downloader-torrent.js')
  , util = require('util')
  ;

var Role = require('../role');

var DownloaderTorrent = module.exports = function() {
  this.init();
}

util.inherits(DownloaderTorrent, Role);

DownloaderTorrent.prototype.init = function() {
  var self = this;
  logger.info('DownloaderTorrent up and running');
}

//
// Overrides
//
DownloaderTorrent.prototype.getName = function() {
  return "downloader-torrent";
}

DownloaderTorrent.prototype.getDisplayName = function() {
  return "DownloaderTorrent";
}

DownloaderTorrent.prototype.start = function() {
  var self = this;
  self.emit('started');
}

DownloaderTorrent.prototype.end = function() {
  var self = this;
  self.emit('ended');
}