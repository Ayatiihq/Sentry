"use strict";
/*
 * generic.js: a generic scraper
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
  , Infringements = acquire('infringements')
  , states = acquire('states')
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
  self.backupInfringements = [];
  self.wrangler = null;
  self.infringements = new Infringements();
};


Generic.prototype.emitInfringementUpdates = function (infringement, parents, extradata) {
  var self = this;

  // make sure to relate the last parent URI to the top level infringement
  if (parents.length) { self.emit('relation', infringement.uri, parents.last()); }
  
  // go through our list of parents for the given uri, make an infringement of them all
  // make relations between them
  for (var i = 0; i < parents.length; i++) {
    self.emit('infringement',
              parents[i],
              {score: MAX_SCRAPER_POINTS/2, source: 'scraper.generic', message: 'Parent'});
    if (i > 0) {
      self.emit('relation', parents[i - 1], parents[i]);
    }
  }  
  var metadata = extradata.filter(function findEndpoints(v) { return !(v.isEndpoint); });
  // if we have an endpoint uri in the extra data, we should make a link for that and relate it up
  var endpoints = extradata.filter(function findEndpoints(v) { return !!(v.isEndpoint); });

  endpoints.each(function emitEndpoints(endpoint) {
    self.emit('infringement',
              endpoint.toString(),
              {score: MAX_SCRAPER_POINTS, source: 'scraper.generic', message: "Endpoint"});
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
  var promiseArray;
  
  function buildPromises(error, results){
    if(error){
      loggger.error("GenericScraper: Can't fetch links that need scraping : %s", error);
      self.stop();
      return;
    }
    promiseArray = results.map(function promiseBuilder(infringement) {
      return self.checkInfringement.bind(self, infringement);
    });

    Promise.seq(promiseArray).then(function onInfringementsChecked() {
      if (!!self.wrangler) { self.wrangler.quit(); self.wrangler = null }
      self.stop();
    });    
  }

  self.infringements.getNeedsScraping(campaign, buildPromises);
  self.emit('started');
};

Generic.prototype.onWranglerFinished = function (wrangler, infringement, promise, isBackup, items) {
  var self = this;
  wrangler.removeAllListeners();

  logger.info('found ' + items.length  + ' via the wrangler');

  // First figure out what the state update is for this infringement   
  var newState;
  if(items.length > 0){
    newState = states.infringements.state.UNVERIFIED;
  }
  else{
    newState = states.infringements.state.FALSE_POSITIVE;
  }
  self.emit('infringementStateChange', infringement, newState);

  items.each(function onFoundItem(foundItem) {
    var parents = foundItem.parents;
    var metadata = foundItem.items;
    metadata.isBackup = isBackup;
    self.emitInfringementUpdates(infringement, parents, metadata);
  });
  promise.resolve(items);
};

Generic.prototype.checkInfringement = function (infringement) {
  var self = this;
  var promise = new Promise.Promise();
  var wrangler = new BasicWrangler();
  wrangler.addRule(acquire('wrangler-rules').rulesLiveTV);
  wrangler.on('finished', self.onWranglerFinished.bind(self, wrangler, infringement, promise, false));
  wrangler.beginSearch(infringement.uri);
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