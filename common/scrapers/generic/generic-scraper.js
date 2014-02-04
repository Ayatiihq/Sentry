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
  , blacklist = acquire('blacklist')
  , events = require('events')
  , logger = acquire('logger').forFile('generic-scraper.js')
  , util = require('util')
  , utilities = acquire('utilities')
  , url = require('url')
  , sugar = require('sugar')
  , states = acquire('states')
  , when = require('node-promise').when
  , wranglerRules = acquire('wrangler-rules')
;

var BasicWrangler = acquire('basic-endpoint-wrangler').Wrangler
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Promise = require('node-promise')
;

var Scraper = acquire('scraper');

var Generic = module.exports = function () {
  this.init();
};

util.inherits(Generic, Scraper);

var MAX_SCRAPER_POINTS = 50;
var MAX_INFRINGEMENTS = 100;

var safeDomains = blacklist.safeDomains;

Generic.prototype.init = function () {
  var self = this;
  self.backupInfringements = [];
  self.wrangler = null;
  self.hosts = new Hosts();
  self.infringements = new Infringements();

  self.activeScrapes = 0;
  self.maxActive = 10;
  self.numInfringementsChecked = 0;
  self.activeInfringements = [];
  self.touchId_ = 0;
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
    if (!arrayHas(endpoint.toString(), safeDomains)) {
      self.emit('infringement',
                endpoint.toString(),
                {score: MAX_SCRAPER_POINTS, source: 'scraper.generic', message: "Endpoint"});
      self.emit('relation', infringement.uri, endpoint.toString());
    }
  });
};

//
// Overrides
//
Generic.prototype.getName = function () {
  return "Generic";
};

Generic.prototype.searchWithOneUrl = function (campaign, url) {
  var self = this;
  self.campaign = campaign;
  self.checkURLS = [{uri: url}];
  self.activeScrapes = 0;
  self.suspendedScrapes = 0;

  if (campaign.metadata.blacklist)
    safeDomains.add(campaign.metadata.blacklist);
 
  self.checkInfringement({uri: url});
  self.emit('started');
}

Generic.prototype.start = function (campaign, job, browser) {
  var self = this;
  self.campaign = campaign;
  self.job = job;

  browser.quit(); // not using it right now.
  
  self.activeInfringements = [];
  self.activeScrapes = 0;
  self.suspendedScrapes = 0;

  if (campaign.metadata.blacklist)
    safeDomains.add(campaign.metadata.blacklist);

  self.touchId_ = setInterval(function() {
    self.activeInfringements.forEach(function(infringement) {
      self.infringements.touch(infringement);
    });
  }, 10 * 60 * 1000);
   
  self.pump(true);
  
  self.emit('started');
};

// TODO
// This needs to be refactored, hits the db everytime, should only query once.
Generic.prototype.pump = function (firstRun) {
  var self = this;
  if (self.activeScrapes <= 0 && self.suspendedScrapes <= 0 && !firstRun) {
    logger.info('Finishing up, no more urls to check');
    if (self.touchId_)
      clearInterval(self.touchId_);
    
    self.stop();
    return;
  }

  var check = self.activeScrapes < self.maxActive;              // we don't have more than maxActive currently running scrapes
  check &= self.numInfringementsChecked <= MAX_INFRINGEMENTS;   // we have checked less than MAX_INFRINGEMENTS infringements

  if (check) {
    self.infringements.getOneNeedsScraping(self.campaign, function(err, infringement) {

      if (!infringement || !infringement.uri)
        return;

      self.numInfringementsChecked = self.numInfringementsChecked + 1;
      self.activeScrapes = self.activeScrapes + 1;
      self.activeInfringements.push(infringement);

      logger.info('starting infrigement: %s (%d/%d) [%d-%d/%d]', infringement.uri, 
                                                                 MAX_INFRINGEMENTS - self.numInfringementsChecked, 
                                                                 self.numInfringementsChecked,
                                                                 self.activeScrapes, self.suspendedScrapes,
                                                                 self.maxActive);

      self.checkInfringement(infringement).then(function () {
        self.pump();
      });

      self.pump(); // pump again
    });
  }
};

Generic.prototype.onWranglerFinished = function (wrangler, infringement, promise, isBackup, items) {
  var self = this;
  wrangler.removeAllListeners();

  // First figure out what the state update is for this infringement   
  var newState = states.infringements.state.UNVERIFIED;
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

  self.activeInfringements.remove(infringement);

  promise.resolve(items);
};

Generic.prototype.isLinkInteresting = function (infringement) {
  var self = this;
  if (!infringement || !infringement.uri) {
    logger.warn('Infringement isn\'t valid: %j', infringement);
    return false;
  }
  // If its pathless, no point.
  if (!utilities.uriHasPath(infringement.uri)) {
    logger.info('%s has no path, not scraping', infringement.uri);
    self.emit('infringementStateChange', infringement, states.infringements.state.UNVERIFIED);
    return false
  }
  // If its safe, no point.
  if (arrayHas(infringement.uri, safeDomains)) {
    logger.info('%s is a safe domain', infringement.uri);
    self.emit('infringementStateChange', infringement, states.infringements.state.FALSE_POSITIVE);
    return false;
  }
  return true;
}

Generic.prototype.checkInfringement = function (infringement) {
  var category = states.infringements.category
    , promise = new Promise.Promise()
    , self = this
  ;
  
  if(!self.isLinkInteresting(infringement)){
    promise.resolve();
    return promise;
  }
  // Otherwise go digging.  
  function getKnownDomains(category){
    var innerPromise = new Promise.Promise();
    self.hosts.getDomainsByCategory(category, function(err, domains){
      if(err)
        return innerPromise.reject(err);
      innerPromise.resolve({'category' : category, 'domains' : domains});
    });    
    return innerPromise;
  }

  var knownCls = getKnownDomains(category.CYBERLOCKER);
  var knownTorrs = getKnownDomains(category.TORRENT);

  Promise.allOrNone([knownCls, knownTorrs]).then(function(results){
    //logger.info('result fixes : ' + JSON.stringify(results));
    var cls = results.filter(function(result){ return result.category === category.CYBERLOCKER});
    var torrentSites = results.filter(function(result){ return result.category === category.TORRENT});
    var combined = results.map(function(result){return result.domains});
    
    if(arrayHas(infringement.uri, cls.first().domains)){
      logger.info('%s is a cyberlocker', infringement.uri);
      // FIXME: This should be done in another place, is just a hack, see
      //        https://github.com/afive/sentry/issues/65
      // It's a cyberlocker URI, so important but we don't scrape it further
      self.emit('infringementStateChange', infringement, states.infringements.state.UNVERIFIED);
      self.emit('infringementPointsUpdate', infringement, 'scraper.generic', MAX_SCRAPER_POINTS, 'cyberlocker');
      return promise.resolve();        
    }
    
    if(arrayHas(infringement.uri, torrentSites.first().domains)){
      logger.info('%s is a torrent site', infringement.uri);
      // FIXME: This should be done in another place, is just a hack, see
      //        https://github.com/afive/sentry/issues/65
      // It's a cyberlocker URI, so important but we don't scrape it further
      // TODO how this change the category on the infringement.
      self.emit('infringementStateChange', infringement, states.infringements.state.UNVERIFIED);
      self.emit('infringementPointsUpdate', infringement, 'scraper.generic', MAX_SCRAPER_POINTS, 'torrent');
      return promise.resolve();        
    }
    
    var wrangler = new BasicWrangler();      
    var musicRules = wranglerRules.rulesDownloadsMusic;
    var movieRules = wranglerRules.rulesDownloadsMovie;
    
    musicRules.push(wranglerRules.ruleSearchAllLinks(combined, wranglerRules.searchTypes.DOMAIN));
    movieRules.push(wranglerRules.ruleSearchAllLinks(combined, wranglerRules.searchTypes.DOMAIN));
    
    var rules = {'music' : musicRules,
                 'tv': wranglerRules.rulesLiveTV,
                 'movie': movieRules};

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
  },
  function(err){
    promise.reject(err);
  });
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

// Utils
function arrayHas(test, arr) {
  return !!arr.count(function (v) { return test.has(v); });
};
