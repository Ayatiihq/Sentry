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
  , Promise = require('node-promise');
;

var Scraper = acquire('scraper');

var Generic = module.exports = function () {
  this.init();
};

util.inherits(Generic, Scraper);

Generic.prototype.init = function () {
  var self = this;

  // hey Neil, replace testurls with whatever and it'll run through that on start() 
  self.testurls = [
                 'http://www.masteetv.com/zee_tv_live_online_free_channel_streaming_watch_zee_tv_HD.php'
                , 'http://1tvlive.in/zee-tv/'
                , 'http://www.roshantv.com/zee_tv.php'
                , 'http://nowwatchtvlive.com/2011/07/zee-tv-live-watch-zee-tv-online-watch-zee-tv-free/'
                , 'http://www.yupptv.com/zee_tv_live.html'
                , 'http://www.youtube.com/watch?v=c50ekRPmHC0'
                , 'http://www.dailymotion.com/video/xskk8y_watch-zee-tv-live-online-zee-tv-free-watch-zee-tv-live-streaming-watch-zee-tv-online-free_shortfilms'
                , 'http://www.bolytv.com/'
                , 'http://www.webtvonlinelive.com/2007/11/live-zee-tv-channel.html'
                , 'http://fancystreems.com/default.asp@pageId=42.php'];

  self.backupUrls = [];
  self.wrangler = new Wrangler();
  self.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
};


Generic.prototype.emitURI = function (uri, parents, extradata) {
  var self = this;
  // go through our list of parents for the given uri, make an infringement of them all
  // make relations between them
  for (var i = 0; i < parents.length; i++) {
    self.emit('infringement', parents[i]);
    if (i > 0) {
      self.emit('relation', parents[i - 1], parents[i]);
    }
  };

  // emit infringement on the last uri and if we have parents, make relations
  self.emit('infringement', uri, extradata);
  if (parents.length) { self.emit('relation', parents.last()); }
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
    if (!!self.wrangler) { self.wrangler.quit(); }
    
    if (self.backupUrls.length) {
      var backupPromiseArray = self.backupUrls.map(function backupPromiseBuilder(uri) {
        return self.backupCheckURI.bind(self, uri);
      });

      Promise.seq(backupPromiseArray).then(function onBackupURISChecked() {
        self.stop();
      });
    }
    else {
      self.stop();
    }
  });

  logger.info('started for %s', campaign);
  self.emit('started');
};

Generic.prototype.onWranglerFinished = function (wrangler, promise, isBackup, items) {
  logger.info('found ' + items.length + 'items for uri: ' + uri);
  var metadata = items;
  if (isBackup) { metadataisBackup = true; }
  self.emitURI(items.uri, items.parents, metadata);

  wrangler.removeAllListeners();
  promise.resolve(items);
};

Generic.prototype.checkURI = function (uri) {
  var self = this;
  var promise = new Promise.Promise();
  logger.info('running check for: ' + uri);

  if (!!self.wrangler) { self.wrangler = new Wrangler(); self.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV); }

  self.wrangler.on('finished', self.onWranglerFinished.bind(self, self.wrangler, promise, false));

  self.wrangler.on('error', function onWranglerError(error) {
    // wrangler died for some reason, we need to go for the backup solution
    self.wrangler = null;
    self.backupUrls.push(url);
    self.wrangler.resolve();
  });

  self.wrangler.beginSearch(uri);
  return promise;
};

Generic.prototype.backupCheckURI = function (uri) {
  var self = this;
  var promise = new Promise.Promise();
  var wrangler = new BasicWrangler();
  wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
  wrangler.on('finished', onWranglerFinished.bind(self, wrangler, promise, false));

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

// no infrastructure support right now, so just make object for testing
var test = new Generic();
//test.start('http://google.com/', '');
//test.start('', '');