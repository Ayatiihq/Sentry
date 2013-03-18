"use strict";
/*
 * google.js: a google scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper that can scrape all types of media and always takes 5mins to complete
 * it's job. It can be paused and, if so, it will resume it's five minute
 * timeout.
 *
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('generic-scraper.js')
  , util = require('util')
  , sugar = require('sugar')
  , BasicWrangler = acquire('basic-endpoint-wrangler').Wrangler
  , Wrangler = acquire('endpoint-wrangler').Wrangler
  , Infringements = acquire('infringements').Infringements
  , Promise = require('node-promise')
;

var Scraper = acquire('scraper');

var Generic = module.exports = function () {
  this.init();
};

util.inherits(Generic, Scraper);

var MAX_SCRAPER_POINTS = 20;

Generic.prototype.init = function () {
  var self = this;

  // hey Neil, replace testurls with whatever and it'll run through that on start() 
  // this was just like ten urls from google that i grabbed
  // don't have empty uris
  self.testurls = [
     'http://www.masteetv.com/zee_tv_live_online_free_channel_streaming_watch_zee_tv_HD.php'
    , 'http://www.bolytv.com/'
    , 'http://www.youtube.com/watch?v=c50ekRPmHC0'
    , 'http://1tvlive.in/zee-tv/'
    , 'http://www.roshantv.com/zee_tv.php'
    , 'http://nowwatchtvlive.com/2011/07/zee-tv-live-watch-zee-tv-online-watch-zee-tv-free/'
    , 'http://www.yupptv.com/zee_tv_live.html'
    , 'http://www.dailymotion.com/video/xskk8y_watch-zee-tv-live-online-zee-tv-free-watch-zee-tv-live-streaming-watch-zee-tv-online-free_shortfilms'
    , 'http://www.webtvonlinelive.com/2007/11/live-zee-tv-channel.html'
    , 'http://fancystreems.com/default.asp@pageId=42.php'
  ].compact();

  self.backupUrls = [];
  self.wrangler = null;
  // Bump the max points on this scraper because it will try to emit endPoints. 
};


Generic.prototype.emitURI = function (uri, parents, extradata) {
  var self = this;
  // go through our list of parents for the given uri, make an infringement of them all
  // make relations between them
  for (var i = 0; i < parents.length; i++) {
    self.emit('infringement', parents[i], MAX_SCRAPER_POINTS/2);
    if (i > 0) {
      self.emit('relation', parents[i - 1], parents[i]);
    }
  }
  
  var metadata = extradata.filter(function findEndpoints(v) { return !(v.isEndpoint); });

  // emit infringement on the last uri and if we have parents, make relations
  self.emit('infringement', uri, MAX_SCRAPER_POINTS/2, metadata);
  if (parents.length) { self.emit('relation', parents.last()); }

  // if we have an endpoint uri in the extra data, we should make a link for that and relate it up
  var endpoints = extradata.filter(function findEndpoints(v) { return !!(v.isEndpoint); });

  endpoints.each(function emitEndpoints(endpoint) {
    self.emit('infringement', endpoint.toString(), MAX_SCRAPER_POINTS);
    self.emit('relation', endpoint.toString(), parents.last());
  });
};

//
// Overrides
//
Generic.prototype.getName = function () {
  return "Generic";
};

Generic.prototype.start = function (campaign, job) {
  var self = this;


  var promiseArray = self.testurls.map(function promiseBuilder(uri) {
    return self.checkURI.bind(self, uri);
  });

  Promise.seq(promiseArray).then(function onURISChecked() {
    // once all the selenium promises resolve, we can start our backup base-endpoint-wrangler run
    if (!!self.wrangler) { self.wrangler.quit(); self.wrangler = null }
    
    if (self.backupUrls.length) {
      var backupPromiseArray = self.backupUrls.map(function backupPromiseBuilder(uri) {
        return self.backupCheckURI.bind(self, uri);
      });

      logger.info('Starting backup run for ' + backupPromiseArray.length + ' uris');
      Promise.seq(backupPromiseArray).then(function onBackupURISChecked() {
        logger.info('Finished backup run');
        self.stop();
      });
    }
    else {
      self.stop();
    }
  });
  self.emit('started');
};

Generic.prototype.onWranglerFinished = function (wrangler, promise, isBackup, items) {
  var self = this;
  wrangler.removeAllListeners();

  logger.info('found ' + items.length);
  items.each(function onFoundItem(foundItem) {
    var uri = foundItem.uri;
    var parents = foundItem.parents;
    var metadata = foundItem.items;
    metadata.isBackup = isBackup;

    self.emitURI(uri, parents, metadata);
  });

  
  promise.resolve(items);
};

Generic.prototype.checkURI = function (uri) {
  var self = this;
  var promise = new Promise.Promise();
  logger.info('running check for: ' + uri);

  if (!self.wrangler) { self.wrangler = new Wrangler(); self.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV); }

  self.wrangler.on('finished', self.onWranglerFinished.bind(self, self.wrangler, promise, false));

  self.wrangler.on('error', function onWranglerError(error) {
    // wrangler died for some reason, we need to go for the backup solution
    logger.info('got error when scraping with selenium (' + uri + '): ' + error.toString());
    self.wrangler.removeAllListeners();
    self.wrangler.quit();
    self.wrangler = null;
    self.backupUrls.push(uri);
    promise.resolve();
  });

  self.wrangler.beginSearch(uri);
  return promise;
};

Generic.prototype.backupCheckURI = function (uri) {
  var self = this;
  var promise = new Promise.Promise();
  var wrangler = new BasicWrangler();
  wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
  wrangler.on('finished', self.onWranglerFinished.bind(self, wrangler, promise, false));
  wrangler.beginSearch(uri);
  return promise;
};

Generic.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Generic.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};