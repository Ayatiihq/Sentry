/*
 * downloader-torrents.js: the downloader
 *
 * (C) 2012 Ayatii Limited
 *
 * TorrentClient actuallly downloads torrents and manages concurrent downloads
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('torrent-client.js')
  , util = require('util')
  ;

var TorrentClient = module.exports = function(campaign) {
  this.campaign_ = campaign;

  this.init();
}

util.inherits(TorrentClient, events.EventEmitter);

TorrentClient.prototype.init = function() {
  var self = this;
}

TorrentClient.prototype.start = function() {
  // Actually do stuff
}