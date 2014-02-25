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
  , logger = acquire('logger').forFile('generic-scraper.js')
  , util = require('util')
  , utilities = acquire('utilities')
  , states = acquire('states')
  , wranglerRules = acquire('wrangler-rules')
;

var BasicWrangler = acquire('basic-endpoint-wrangler').Wrangler
  , categories = states.infringements.category
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Promise = require('node-promise')
;

require('sugar');

var Scraper = acquire('scraper');

/* small class just to handle batching promises up, meh i want generators */
var PromiseBatcher = function (batchSize) {
  this.batchSize = batchSize;
  this.fns = [];
};
PromiseBatcher.prototype.addFn = function (fn) { this.fns.push(fn); };
PromiseBatcher.prototype.startBatches = function () {
  var self = this;

  // TODO - stop batching in chunks like this, when one promise returns fire off the next one
  // so we always have x promises running, but don't request flood.

  var batches = {};
  self.fns.each(function (fn, index) {
    var batchNum = Math.floor(index / self.batchSize);
    var batch = (batches[batchNum]) ? batches[batchNum] : [];

    batch.push(fn);
    batches[batchNum] = batch;
  });

  // now we need to iterate on batches until they are all processed
  var nextBatchNum = 0;
  var totalResults = [];
  function nextBatch() {
    if (Object.has(batches, nextBatchNum)) {
      return Promise.all(batches[nextBatchNum].map(function (fn) { return fn(); })).then(function (results) {
          totalResults = totalResults.union(results);
          nextBatchNum++;
          return nextBatch();
        });
    }
    else { return totalResults; }
  }

  return nextBatch();
};

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
  self.checkURLS = [{ uri: url }];
  self.activeScrapes = 0;
  self.suspendedScrapes = 0;

  if (campaign.metadata.blacklist)
    safeDomains.add(campaign.metadata.blacklist);

  self.checkInfringement({ uri: url });
  self.emit('started');
};

Generic.prototype.start = function (campaign, job) {
  var self = this;
  self.campaign = campaign;
  self.job = job;
  
  self.activeInfringements = [];
  self.activeScrapes = 0;
  self.suspendedScrapes = 0;

  if (campaign.metadata.blacklist)
    safeDomains.add(campaign.metadata.blacklist);

  // get known domains from the database early so we stop requesting them all day
  function getKnownDomains(category) {
    var innerPromise = new Promise.Promise();
    self.hosts.getDomainsByCategory(category, function(err, domains){
      if (err) { innerPromise.reject(err); }
      else { innerPromise.resolve({ 'category': category, 'domains': domains }); }
    });    
    return innerPromise;
  }

  Promise.allOrNone([getKnownDomains(categories.CYBERLOCKER), getKnownDomains(categories.TORRENT)])
  .then(function (results) {
    self.cyberlockers = results.filter({ 'category': categories.CYBERLOCKER });
    self.torrentSites = results.filter({ 'category': categories.TORRENT });
    self.combinedDomains = results.map('domains');
  }).then(function () {
    self.touchId_ = setInterval(function () {
      self.activeInfringements.forEach(function (infringement) {
        self.infringements.touch(infringement);
      });
    }, 10 * 60 * 1000);

    self.pump(true);

    self.emit('started');
  });

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

  var check = false;
  check = process.memoryUsage().heapUsed < (96 * 1024 * 1024); // check we are using less than 96MB of heap
  check = (check && (self.numInfringementsChecked <= MAX_INFRINGEMENTS));   // we have checked less than MAX_INFRINGEMENTS infringements

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

Generic.prototype.onInfringementFinished = function (infringement, isBackup, items) {
  var self = this;

  // check to see if enough conditions are met, so we can start the second round of endpoint wrangler checks
  if (self.campaign.type === 'music.album' && items.length < 1) {
    // no found items, music.album, ret-2-go!
    // what we do now is go through all the links on the page and run endpoint wrangler on them with a specific ruleset
    // this ruleset will figure out if the link is suspicious enough to warrent another full run of endpoint-wrangler on that page
    
    return self.doSecondAssaultOnInfringement(infringement);
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
  }

  return new Promise.Promise().resolve();
};

Generic.prototype.wrapWrangler = function (uri, ruleOverrides) {
  var self = this;
  var promise = new Promise.Promise();
  var hrtime = process.hrtime();

  var wrangler = new BasicWrangler();
  var ruleSet = ruleOverrides;
  if (ruleSet === undefined) {
    promise.reject(new Error('No rule overrides supplied, wrangler can not run'));
    return promise;
  }

  wrangler.addRule(ruleSet);

  wrangler.on('finished', function onWranglerFinished(foundItems) {
    var newtime = process.hrtime(hrtime);
    var sec = newtime[0] + (newtime[1] / 1000000000);
    logger.info(sec.round(2) + 's: completed (' + uri + ')');
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
};

/* for a given uri, pings all the links we find on that page and returns ones we think are suspicious 
 */
Generic.prototype.findSuspiciousLinks = function (uri) {
  var self = this;

  return self.wrapWrangler(uri, [wranglerRules.findAllLinks])
  .then(function (foundItems) {
    // foundItems now contains all the hrefs of the <a> tags on a page, we need to normalize them
    // with respect to the pages URI, so '<a href="test.html">' expands to '<a href="http://foo.com/test.html">'
    var links = foundItems.first().items.map(function (foundItem) {
      return utilities.joinURIS(uri, foundItem.data, foundItems.first().baseURI);
    });

    links = links.compact(); 
    links = links.unique();
    
    //remove any links that look like infringement.uri
    // it looks like vomit because we want to remove anything past ? or # in the uri

    links = links.remove(function (link) { return (link.split('#')[0].split('?')[0] === uri.split('#')[0].split('?')[0]); });
    // for each link we need to make sure its not something we should be ignoring for whatever reason

    // go through the links we got from scraping all the hrefs on the page and run the checkForInfo rule on it
    // this will return with an Endpoint with wranglerRules.checkForInfoHash set as its data if checkForInfo
    // thinks the link is suspicious

    // use promise batcher to batch up these requests because web servers are snobby
    var batcher = new PromiseBatcher(10);
    links.each(function (link) {
      var infoRule = wranglerRules.checkForInfo(link,
                                            self.campaign.metadata.artist,
                                            self.campaign.metadata.albumTitle,
                                            self.campaign.metadata.assets.map(function (asset) { return asset.title; }),
                                            self.campaign.metadata.year);
      batcher.addFn(self.wrapWrangler.bind(self, link, [infoRule]));
    });

    return batcher.startBatches().then(function (results) {
      // find all the links that have the required checkForInfoHash as an endpoint
      var suspiciousURIS = results.flatten().compact();
      suspiciousURIS = suspiciousURIS.map(function (endpoints) { return endpoints.items.find({ 'data': wranglerRules.checkForInfoHash }); }).map('sourceURI');
      suspiciousURIS.unique();
      suspiciousURIS.compact();
      return suspiciousURIS;
    });
  });
};

/* The idea with this is that when we go through a page the first time, to generics eyes it may not find anything interesting
 * but often the interesting thing is just a click away. this is often the case when generic lands on search engine pages 
 * such as a torrent search engine. if it just clicked those links the torrent search engine is pointing at, it would find so much gold.
 *
 * but then the problem of which links are the ones that we are interested in comes to mind. doSecondAssaultOnInfringement attempts to solve that
 * it will go through all the links listed on the infringement.uri page and re-run endpoint-wrangler on the ones that it qualifies as being suspicious
 * which should generate a whole host of new infringements for us
 */ 
Generic.prototype.doSecondAssaultOnInfringement = function (infringement) {
  var self = this;

  // find all the suspicious looking pages linked from infringement.uri
  return self.findSuspiciousLinks(infringement.uri)
  .then(function (suspiciousURIS) {
    // we now have a whole bunch of new URIS to scrape hopefully, so generate a new ruleset 
    var ruleSet = self.generateRulesForCampaign();

    // use Promise batcher to manage our promises in batches
    var batcher = new PromiseBatcher(10);
    suspiciousURIS.each(function (uri) { batcher.addFn(self.wrapWrangler.bind(self, uri, ruleSet)); });

    return batcher.startBatches().then(function (results) {
      var foundItems = results.flatten();
      // foundItems now has all the found items over alll the suspicious uris
      if (foundItems.length > 0) {
        self.emit('infringementStateChange', infringement, states.infringements.state.UNVERIFIED);
        foundItems.each(function onFoundItem(foundItem) {
          // we are another level deep, so unshift the infringement.uri onto the parents array
          foundItem.parents.unshift(infringement.uri);
          foundItem.items.isBackup = false;
          self.emitInfringementUpdates(infringement, foundItem.parents, foundItem.items);
        });
      }

      self.activeInfringements.remove(infringement);
      return foundItems;
    });
  });
};

Generic.prototype.generateRulesForCampaign = function (additionalDomains) {
  var self = this;
  var musicRules = wranglerRules.rulesDownloadsMusic(additionalDomains);
  var movieRules = wranglerRules.rulesDownloadsMovie(additionalDomains);

  var rules = {
    'music': musicRules,
    'tv': wranglerRules.rulesLiveTV,
    'movie': movieRules
  };
  var ruleSet = rules[self.campaign.type.split('.')[0]];

  return ruleSet;
};

Generic.prototype.checkInfringement = function (infringement) {
  var self = this;
  var ruleSet = self.generateRulesForCampaign(self.combinedDomains);
  var wranglerPromise = self.wrapWrangler(infringement.uri, ruleSet);
  return wranglerPromise.then(self.onInfringementFinished.bind(self, infringement, false));
};

Generic.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Generic.prototype.isAlive = function (cb) {
  cb();
};

// Utils
function arrayHas(test, arr) {
  return arr.some(RegExp(test.escapeRegExp()));
}

// for testing
if (require.main === module) {
  // NOTE, if you are using this for testing remember to disable self.pump() calls in generic
  // else it goes off looking for new infringements because we didn't code in a functional way, so its all intertwined
  var metadata = {
    'artist': "Girls Generation",
    'albumTitle': "The Boys",
    'year': '2011',
    'assets': [
      {'title': 'The Boys'},
      {'title': 'Say Yes'},
      {'title': 'Trick'}
    ]
  };

  var campaign = {
    'metadata': metadata,
    'type': 'music.album',
  };

  var generic = new Generic();
  generic.campaign = campaign;

  var ruleSet = generic.generateRulesForCampaign();
  //var url = 'http://mp3skull.com/mp3/the_boys_girls_generation.html'
  //var url = 'http://isohunt.to/torrents/?ihq=Girls+Generation+The+Boys';
  var url = 'http://www.musicaddict.com/mp3/the-boys-girls-generation.html';
  //var url = 'http://www.musicaddict.com/download/1064286-girls-generation--the-boys-mp3.html';

  var infringement = { 'uri': url };

  generic.wrapWrangler(url, ruleSet)
  .then(function (foundItems) {
    return generic.doSecondAssaultOnInfringement(infringement).then(function (results) { if (foundItems) { results.push(foundItems) }; return results });
  })
  .then(function (things) {
    if (things) {
      things.each(function (thing) { if (thing.items) { thing.items.each(console.log); } });
    }
  });
}
