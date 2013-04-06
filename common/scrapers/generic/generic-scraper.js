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
  , cyberlockers = acquire('cyberlockers')
  , events = require('events')
  , logger = acquire('logger').forFile('generic-scraper.js')
  , util = require('util')
  , sugar = require('sugar')
  , BasicWrangler = acquire('basic-endpoint-wrangler').Wrangler
  , Infringements = acquire('infringements')
  , states = acquire('states')
  , Promise = require('node-promise')
  , blacklist = acquire('blacklist')
;

var Scraper = acquire('scraper');

var Generic = module.exports = function () {
  this.init();
};

util.inherits(Generic, Scraper);

var MAX_SCRAPER_POINTS = 20;
var MAX_INFRINGEMENTS = 100;

var safeDomains = blacklist.safeDomains;

Generic.prototype.init = function () {
  var self = this;
  self.backupInfringements = [];
  self.wrangler = null;
  self.infringements = new Infringements();

  self.activeScrapes = 0;
  self.maxActive = 10;
  self.numInfringementsChecked = 0;
  self.checkURLS = [];
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
              {score: MAX_SCRAPER_POINTS / 2, source: 'scraper.generic', message: 'Parent'});
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
  self.campaign = campaign;
  self.job = job;

  self.infringements.getNeedsScraping(campaign, MAX_INFRINGEMENTS, function (error, results) {
    if (error) {
      logger.error("Generic Scraper: Can't fetch links that need scraping: %s", error);
      self.stop();
      return;
    }

    self.checkURLS = results;
    self.activeScrapes = 0;
    self.suspendedScrapes = 0;

    if (campaign.metadata.blacklist)
      safeDomains.add(campaign.metadata.blacklist);
   
    self.pump(true);
  });
  self.emit('started');
};

Generic.prototype.pump = function (firstRun) {
  var self = this;

  if (self.activeScrapes <= 0 && self.suspendedScrapes <= 0 && !firstRun) {
    logger.info('Finishing up, no more urls to check');
    self.stop();
    return;
  }

  var check = self.activeScrapes < self.maxActive;              // we don't have more than maxActive currently running scrapes
  check &= self.checkURLS.length > 0;                           // we still have urls to check
  check &= self.numInfringementsChecked <= MAX_INFRINGEMENTS;   // we have checked less than MAX_INFRINGEMENTS infringements

  if (check) {
    var infringement = self.checkURLS.pop();
    while (infringement.uri[0] === '/') {
      logger.error('infringement %s is not valid', infringement.uri);
      infringement = self.checkURLS.pop();
      if (!infringement) { return; }
    }
    self.numInfringementsChecked = self.numInfringementsChecked + 1;
    self.activeScrapes = self.activeScrapes + 1;

    logger.info('starting infrigement: %s (%d/%d) [%d-%d/%d]', infringement.uri, 
                                                               MAX_INFRINGEMENTS - self.numInfringementsChecked, 
                                                               self.numInfringementsChecked,
                                                               self.activeScrapes, self.suspendedScrapes,
                                                               self.maxActive);

    self.checkInfringement(infringement).then(function () {
      self.pump();
    });


    self.pump(); // pump again
  }
};

Generic.prototype.onWranglerFinished = function (wrangler, infringement, promise, isBackup, items) {
  var self = this;
  wrangler.removeAllListeners();

  // First figure out what the state update is for this infringement   
  var newState;
  if (items.length > 0) {
    newState = states.infringements.state.UNVERIFIED;
  }
  else {
    newState = states.infringements.state.FALSE_POSITIVE;
  }
  self.emit('infringementStateChange', infringement, newState);

  items.each(function onFoundItem(foundItem) {
    var parents = foundItem.parents;
    var metadata = foundItem.items;
    metadata.isBackup = isBackup;
    self.emitInfringementUpdates(infringement, parents, metadata);
  });

  if (!wrangler.isSuspended) {
    self.activeScrapes = self.activeScrapes - 1;
  }
  else {
    self.suspendedScrapes = self.suspendedScrapes - 1;
  }

  promise.resolve(items);
};

Generic.prototype.checkInfringement = function (infringement) {
  var self = this;
  var promise = new Promise.Promise();

  function arrayHas(test, arr) {
    return !!arr.count(function (v) { return test.has(v); });
  };

  if (arrayHas(infringement.uri, safeDomains)) {
    // auto reject this result
    self.emit('infringementStateChange', infringement, states.infringements.state.FALSE_POSITIVE);
    promise.resolve();

  } else if (arrayHas(infringement.uri, cyberlockers.knownDomains)) {
    // FIXME: This should be done in another place, is just a hack, see
    //        https://github.com/afive/sentry/issues/65
    // It's a cyberlocker URI, so important but we don't scrape it further
    self.emit('infringementPointsUpdate', infringement, 'generic', 10, 'cyberlocker');
    promise.resolve();
  } else {
    var wrangler = new BasicWrangler();

    var rules = {
      'music': acquire('wrangler-rules').rulesDownloadsMusic,
      'tv': acquire('wrangler-rules').rulesLiveTV
    };

    wrangler.addRule(rules[self.campaign.type.split('.')[0]]);

    wrangler.on('finished', self.onWranglerFinished.bind(self, wrangler, infringement, promise, false));
    wrangler.on('suspended', function onWranglerSuspend() {
      self.activeScrapes = self.activeScrapes - 1;
      self.suspendedScrapes = self.suspendedScrapes + 1;
      self.pump();
    });
    wrangler.on('resumed', function onWranglerResume() {
      self.activeScrapes = self.activeScrapes + 1;
      self.suspendedScrapes = self.suspendedScrapes - 1;
      self.pump();
    });
    wrangler.beginSearch(infringement.uri);
  }
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