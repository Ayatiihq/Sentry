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
  , URI = require('URIjs')
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

Generic.prototype.start = function (campaign, job) {
  var self = this;
  self.campaign = campaign;
  self.job = job;
  
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

Generic.prototype.onWranglerFinished = function (infringement, isBackup, items) {
  var self = this;
  var promise = new Promise.Promise();

  // check to see if enough conditions are met, so we can start the second round of endpoint wrangler checks
  if (self.campaign.type === 'music.album' && items.length < 1) {
    // no found items, music.album, ret-2-go!
    // what we do now is go through all the links on the page and run endpoint wrangler on them with a specific ruleset
    // this ruleset will figure out if the link is suspicious enough to warrent another full run of endpoint-wrangler on that page
    
    self.doSecondAssaultOnInfringement(infringement).then(promise.resolve());
  }
  else {
    // First figure out what the state update is for this infringement   
    var newState = states.infringements.state.UNVERIFIED;
    self.emit('infringementStateChange', infringement, newState);

    items.each(function onFoundItem(foundItem) {
      var parents = foundItem.parents;
      var metadata = foundItem.items;
      metadata.isBackup = isBackup;
      self.emitInfringementUpdates(infringement, parents, metadata);
    });

    self.activeInfringements.remove(infringement);

    promise.resolve();
  }
  return promise;
};

Generic.prototype.isLinkInteresting = function (uri) {
  var self = this;

  // If its pathless, no point.
  if (!utilities.uriHasPath(uri)) {
    logger.info('%s has no path, not scraping', uri);
    return states.infringements.state.UNVERIFIED;
    self.emit('infringementStateChange', infringement, states.infringements.state.UNVERIFIED);
  }
  // If its safe, no point.
  if (arrayHas(uri, safeDomains)) {
    logger.info('%s is a safe domain', uri);
    return states.infringements.state.FALSE_POSITIVE;
    self.emit('infringementStateChange', infringement, states.infringements.state.FALSE_POSITIVE);
  }
  return null;
}

Generic.prototype.wrapWrangler = function (uri, ruleOverrides) {
  var self = this;
  var promise = new Promise.Promise();

  var wrangler = new BasicWrangler();
  var ruleSet = ruleOverrides;
  if (ruleSet === undefined) {
    promise.reject(new Error('No rule overrides supplied, wrangler can not run'));
    return promise;
  }

  wrangler.addRule(ruleSet);

  wrangler.on('finished', function onWranglerFinished(foundItems) {
    wrangler.removeAllListeners();
    if (!wrangler.isSuspended) {
      self.activeScrapes = self.activeScrapes - 1;
    }
    else {
      self.suspendedScrapes = self.suspendedScrapes - 1;
    }
    promise.resolve(foundItems);
  });
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
  wrangler.on('error', function onWranglerError(err) { 
    promise.reject(err);
  });
  wrangler.beginSearch(uri);

  return promise;
}

Generic.prototype.doSecondAssaultOnInfringement = function (infringement) {
  var self = this;

  // first find all links on the page
  return self.wrapWrangler(infringement.uri, [wranglerRules.findAllLinks])
             .then(function (foundItems) { 
        var accumPromises = [];
        var links = [];
        // for each link, run the wrangler on it with the checkForInfo ruleset
        // which will figure out if the page is interesting or not

        // normalize hrefs found into an array of strings
        foundItems.each(function (foundItem) {
          var composedURI = null;
          try {
            composedURI = URI(infringement.uri).absoluteTo(foundItem.data);
          } catch (error) {
            composedURI = null; // probably 'javascript;'
          }

          if (composedURI !== null) {
            links.push(composedURI);
          }
        });

        links = links.unique(); // make our list unique
        //remove any links that look like infringement.uri
        links = links.remove(function (link) { return (link.split('#')[0].split('?')[0] === infringement.uri.split('#')[0].split('?')[0]); });

        // go through each link left over and run checkForInfo rule on it
        

        links.each(function (link) {
          var infoRule = wranglerRules.checkForInfo(link,
                                                    self.campaign.metadata.artist, 
                                                    self.campaign.metadata.albumTitle,
                                                    self.campaign.metadata.assets.map(function (asset) { return asset.title; }),
                                                    self.campaign.metadata.year);
          accumPromises.push(self.wrapWrangler(link, [infoRule]));
        });

        return Promise.all(accumPromises).then(function (results) {
          var concatedItems = [];
          results.each(function (foundItems) {
            // check results for an endpoint that looks like checkForInfoHash
            var test = foundItems.first({ 'data': wranglerRules.checkForInfoHash});
            if (test) {
              var pageURI = test.sourceURI;
              foundItems = foundItems.remove({'data': wranglerRules.checkForInfoHash});
              concatedItems.push(foundItems);
            }
          });

          // foundItems is now a normal looking foundItems array, we can start emitting infringements
          foundItems = concatedItems.flatten();
          // First figure out what the state update is for this infringement   
          var newState = states.infringements.state.UNVERIFIED;
          self.emit('infringementStateChange', infringement, newState);

          foundItems.each(function onFoundItem(foundItem) {
            var parents = foundItem.parents;
            parents.unshift(infringement.uri);
            var metadata = foundItem.items;
            metadata.isBackup = isBackup;
            self.emitInfringementUpdates(infringement, parents, metadata);
          });

          self.activeInfringements.remove(infringement);
        });
      });
}

/* figures out if we should continue processing this uri */
Generic.prototype.checkURI = function (uri) {
  var self = this;
  var promise = new Promise.Promise();
  var promiseResolveData = {'stateChange': null, 'pointsChange': null};

  // check to see if there are any problems with the URI, isLinkInteresting() can return a state change
  var linkInterestingResult = self.isLinkInteresting(uri)
  if(linkInterestingResult !== null) {
    promiseResolveData['stateChange'] = linkInterestingResult;
    promise.resolve(promiseResolveData);
    return promise;
  }

  // check the uri against domains in the DB so we can ignore certain domains
  function getKnownDomains(category){
    var innerPromise = new Promise.Promise();
    self.hosts.getDomainsByCategory(category, function(err, domains){
      if (err) { innerPromise.reject(err); }
      else { innerPromise.resolve({'category' : category, 'domains' : domains}) };
    });    
    return innerPromise;
  }

  var knownCls = getKnownDomains(category.CYBERLOCKER);
  var knownTorrs = getKnownDomains(category.TORRENT);

  Promise.allOrNone([knownCls, knownTorrs]).then(function (results) {
    var domainPromise = new Promise.Promise();
    //logger.info('result fixes : ' + JSON.stringify(results));
    var cls = results.filter(function(result){ return result.category === category.CYBERLOCKER});
    var torrentSites = results.filter(function(result){ return result.category === category.TORRENT});
    var combined = results.map(function(result){return result.domains});
    
    if(arrayHas(uri, cls.first().domains)) {
      logger.info('%s is a cyberlocker', uri);
      // FIXME: This should be done in another place, is just a hack, see
      //        https://github.com/afive/sentry/issues/65
      // It's a cyberlocker URI, so important but we don't scrape it further
      promiseResolveData.stateChange = states.infringements.state.UNVERIFIED;
      promiseResolveData.pointsChange = [MAX_SCRAPER_POINTS, 'cyberlocker'];
    } 
    if (arrayHas(uri, torrentSites.first().domains)) {
      logger.info('%s is a torrent site', uri);
      // FIXME: This should be done in another place, is just a hack, see
      //        https://github.com/afive/sentry/issues/65
      // It's a cyberlocker URI, so important but we don't scrape it further
      // TODO how this change the category on the infringement.
      promiseResolveData.stateChange = states.infringements.state.UNVERIFIED;
      promiseResolveData.pointsChange = [MAX_SCRAPER_POINTS, 'torrent'];
    }

    return domainPromise.resolve(promiseResolveData);
  }).then(function(resolveData) { promise.resolve(resolveData); });

  return promise;
}

Generic.prototype.generateRulesForCampaign = function () {
  var musicRules = wranglerRules.rulesDownloadsMusic;
  var movieRules = wranglerRules.rulesDownloadsMovie;
    
  //musicRules.push(wranglerRules.ruleSearchAllLinks(combined, wranglerRules.searchTypes.DOMAIN));
  //movieRules.push(wranglerRules.ruleSearchAllLinks(combined, wranglerRules.searchTypes.DOMAIN));
    
  var rules = {'music' : musicRules,
                'tv': wranglerRules.rulesLiveTV,
                'movie': movieRules};
  var ruleSet = rules[self.campaign.type.split('.')[0]];

  return ruleSet;
}

Generic.prototype.checkInfringement = function (infringement, overrideURI, additionalRules) {
  var category = states.infringements.category
    , promise = new Promise.Promise()
    , self = this
    , uri = (overrideURI) ? overrideURI : infringement.uri;
  ;
  
  return self.checkURI(infringement.uri).then(function (checkURIResult) {
    if (checkURIResult.stateChange !== null && checkURIResult.pointsChange !== null) {
      var ruleSet = self.generateRulesForCampaign();
      var wranglerPromise = self.wrapWrangler(infringement.uri, ruleSet);
      return wranglerPromise.then(self.onWranglerFinished.bind(self, infringement, false));
    }

    if (checkURIResult.stateChange) { 
      self.emit('infringementStateChange', infringement, checkURIResult.stateChange); 
    }
    if (checkURIResult.pointsChange) { 
      self.emit('infringementPointsUpdate', infringement, 'scraper.generic', checkURIResult.pointsChange[0], checkURIResult.pointsChange[1]);
    }
  });

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
