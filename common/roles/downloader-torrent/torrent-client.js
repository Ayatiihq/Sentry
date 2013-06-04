"use strict";
/*
 * downloader-torrents.js: the downloader
 *
 * (C) 2012 Ayatii Limited
 *
 * TorrentClient actuallly downloads torrents and manages concurrent downloads
 *
 */

// TODO, hook up what happens when the torrent actually finishes downloading


var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('torrent-client.js')
  , Promise = require('node-promise')
  , torrentDownloader = acquire('torrent-downloader')
  , util = require('util')
;
require('sugar');

var POLLDELAY = 5;
var MAXDOWNLOADS = 2;

// utility function, calls fn(set[i]) one by one
// fn will return a promise.
// if the promise resolves the promise created by this method will resolve with the same data;
// if the promise is rejected, the next dataitem in the set is sent into fn
function execFirstInSet(set, fn) {
  var promise = Promise.Promise()
  if (set.length < 1) { promise.reject(new Error('no items in set')); return promise; }

  var index = 0;

  function doNextIndex() {
    if (index >= set.length) { promise.reject(new Error('all data items rejected')); }
    else {
      return fn(set[index]);
    }
  };

  function setCallbacks(p) {
    p.then(function onPResolved() {
      promise.resolve.apply(promise, arguments);
    }, function onPRejected() {
      index += 1;
      var newPromise = doNextIndex();
      setCallbacks(newPromise);
    });
  };

  var fnPromise = doNextIndex();
  setCallbacks(fnPromise);

  return promise;
};

var TorrentClient = module.exports = function(campaign) {
  this.campaign_ = campaign;

  this.init();
}

util.inherits(TorrentClient, events.EventEmitter);

TorrentClient.prototype.init = function() {
  var self = this;
}

TorrentClient.prototype.start = function() {
  this.cheapPollNewTorrents();
  // Get the first torrent, can call this as many times as you want for concurrent downloads
  // TorrentClient.add is called when the DownloaderTorrent finds a valid infringement to download
  this.emit('getTorrent');

  // If there is an error initialising etc then self.emit('error', err)

  // If you've either reached a timeout for how long things have been running or you want
  // to indicate that you're completely done, self.emit('finished')
}

TorrentClient.prototype.canGetNewTorrent = function () {
  return torrentDownloader.getNumActiveTorrents() < MAXDOWNLOADS;
};

// if cheapStart then we quickly just move on to queuing another poll cycle instead of checking for
// new torrents immediately, gives the RPC api time to breath
TorrentClient.prototype.pollNewTorrents = function (cheapStart) {
  var self = this;

  if (cheapStart || !self.canGetNewTorrent()) {
    self.pollNewTorrents.bind(self).delay(POLLDELAY * 1000); // check every POLLDELAY seconds for new torrents, cheep check
  }
  else {
    self.emit('getTorrent');
  }
};

// so we don't have to pass a boolean into a function, self documenting code is awesome
TorrentClient.prototype.cheapPollNewTorrents = function () {
  this.pollNewTorrents(true);
}


//
// In addition to the standard properties, infringement will also have
// infringement.downloadDir (an already-created unique download directory for this infringement)
// infringement.started (when the download started)
//
TorrentClient.prototype.add = function(infringement) {
  //logger.info('%s', JSON.stringify(infringement, null, '  '));
  var self = this;

  // Do lots of checks on the infringement data, i miss g_return_if_fail :( 
  try { // always have to try/catch this crap because javascript is not really okay with the idea of nested objects
    var potentialURIS = infringement.parents.uris;
  } catch (err) {
    self.emit('torrentErrored', infringement, err);
    logger.error(err);
  }

  // still have to do even more checks
  if (!potentialURIS && potentialURIS.length === 0) {
    self.emit('torrentErrored', infringement, new Error('no torrent uris'));
    logger.error(new Error('no torrent uris'));
    return;
  }
  
  // Checks complete

  // the idea here is to sort our uri list so we get web uris before magnet uris
  // web uris are actual torrent files and thus full of more juicy data like multiple trackers and file lists
  potentialURIS.sort(function (a, b) {
    if (a === b) { return 0; }

    // just store if we have magnet or not here, makes the comparison simpler as we don't have to check multiple times
    var acomp = a.has('magnet://');
    var bcomp = b.has('magnet://');

    if (acomp === bcomp) { return (a < b) ? -1 : 1; }
    else { return (acomp < bcomp) ? -1 : 1; }
  });

  // we use a custom function defined above, execFirstInSet to send multiple data items into a function that provides a promise
  // it is clever enough to only continue sending in data items if the promise is rejected, if it returns correctly it does not continue
  var torrentPromise = execFirstInSet(potentialURIS, torrentDownloader.addFromURI.bind(torrentDownloader, infringement.downloadDir));
  torrentPromise.then(function onTorrentComplete(downloadPromise) {
    // we now get a new promise we can use to track the download
    downloadPromise.then(function onDownloadComplete() {
      self.emit('torrentFinished', infringement);
      logger.info('torrentFinished %s', infringement);
    }, function onDownloadErr(err) {
      self.emit('torrentErrored', infringement, err);
      logger.info('torrentErrored %s - %s', infringement, err);
    });
  }, function onTorrentFailed(err) {
    self.emit('torrentErrored', infringement, err);
    logger.info('torrentErrored %s - %s', infringement, err);
  });

  // Can start downloading the infringement, infringment.parents will be useful

  // Once infringement is downloaded, call self.emit('torrentFinished', infringement);
  // Then self.emit('getTorrent') for a new torrent

  // If torrent is invalid or errors then self.emit('torrentErrored', infringement)
  
  self.cheapPollNewTorrents(); // keeps a poll cycle going 
}

/**
 * Return number of currently active downloads
 */
TorrentClient.prototype.getDownloadCount = function() {
  return 0;
}