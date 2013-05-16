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
  try {// always have to try/catch this crap because javascript is not really okay with the idea of nested objects
    var potentialURIS = infringement.parents.uris;
  } catch (err) {
    self.emit('torrentErrored', infringement, err);
    logger.error(err);
  }

  if (!potentialURIS && potentialURIS.length === 0) {
    // still have to do even more checks
    self.emit('torrentErrored', infringement, new Error('no torrent uris'));
    logger.error(new Error('no torrent uris'));
    return;
  }

  var magnetURIS = potentialURIS.filter(function (n) { return n.has('magnet://'); });
  var webURIS = potentialURIS.filter(function () { return n.has('http://') || n.has('https://'); });

  function onSetupComplete(tPromise) {
    // torrent was succesfully added to the torrent client

  };

  var setupPromise = execFirstInSet(webURIS, torrentDownloader.addFromURI);

  setupPromise.then(onSetupComplete, function onSetupFailed(err) {
    // balls. either we had no uris to download or all of them failed.  
    setupPromise = execFirstInSet(magnetURIS, torrentDownloader.addFromMagnet);
    setupPromise.then(onSetupComplete, function onFullSetupFailed(err) {
      // super balls. no recovering from this
      self.emit('torrentErrored', infringement, err);
      logger.error(err);
    });
  });

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