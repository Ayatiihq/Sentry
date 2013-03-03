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
  self.wrangler = new Wrangler();
  this.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
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
    self.wrangler.quit();
    self.stop();
  });

  logger.info('started for %s', campaign);
  self.emit('started');
};

Generic.prototype.checkURI = function (uri) {
  var self = this;
  var promise = new Promise.Promise();
  logger.info('running check for: ' + uri);

  self.wrangler.on('finished', function onFinished(items) {
    logger.info('found ' + items.length + 'items for uri: ' + uri);
    logger.debug(items);
    self.wrangler.removeAllListeners();
    //self.wrangler.quit();
    promise.resolve(items);
  });

  self.wrangler.beginSearch(uri);
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