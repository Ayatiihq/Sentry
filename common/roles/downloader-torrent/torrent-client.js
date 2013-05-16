"use strict";
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
  
  // Get the first torrent, can call this as many times as you want for concurrent downloads
  // TorrentClient.add is called when the DownloaderTorrent finds a valid infringement to download
  this.emit('getTorrent');

  // If there is an error initialising etc then self.emit('error', err)

  // If you've either reached a timeout for how long things have been running or you want
  // to indicate that you're completely done, self.emit('finished')
}


//
// In addition to the standard properties, infringement will also have
// infringement.downloadDir (an already-created unique download directory for this infringement)
// infringement.started (when the download started)
//
TorrentClient.prototype.add = function(infringement) {
  logger.info('%s', JSON.stringify(infringement, null, '  '));

  // Can start downloading the infringement, infringment.parents will be useful

  // Once infringement is downloaded, call self.emit('torrentFinished', infringement);
  // Then self.emit('getTorrent') for a new torrent

  // If torrent is invalid or errors then self.emit('torrentErrored', infringement)
}

/**
 * Return number of currently active downloads
 */
TorrentClient.prototype.getDownloadCount = function() {
  return 0;
}