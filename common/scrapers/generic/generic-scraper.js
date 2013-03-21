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
  , Wrangler = acquire('endpoint-wrangler').Wrangler
  , Infringements = acquire('infringements')
  , states = acquire('states')
  , Promise = require('node-promise')
  , webdriver = require('selenium-webdriver')
;

var Scraper = acquire('scraper');

var Generic = module.exports = function () {
  this.init();
};

util.inherits(Generic, Scraper);

var MAX_SCRAPER_POINTS = 20;
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

Generic.prototype.init = function () {
  var self = this;
  self.backupInfringements = [];
  self.wrangler = null;
  self.infringements = new Infringements();
  //events.EventEmitter.call(this)
};


Generic.prototype.emitInfringementStateChange = function (infringement, parents, extradata) {
  var self = this;

  // make sure to relate the last parent URI to the top level infringement
  if (parents.length) { self.emit('relation', infringement.uri, parents.last()); }
  
  // go through our list of parents for the given uri, make an infringement of them all
  // make relations between them
  for (var i = 0; i < parents.length; i++) {
    // TODO need to check if one of the parents maybe the original infringement ?
    self.emit('infringement', parents[i], MAX_SCRAPER_POINTS/2);
    if (i > 0) {
      self.emit('relation', parents[i - 1], parents[i]);
    }
  }  
  var metadata = extradata.filter(function findEndpoints(v) { return !(v.isEndpoint); });
  // if we have an endpoint uri in the extra data, we should make a link for that and relate it up
  var endpoints = extradata.filter(function findEndpoints(v) { return !!(v.isEndpoint); });

  endpoints.each(function emitEndpoints(endpoint) {
    self.emit('infringement', endpoint.toString(), MAX_SCRAPER_POINTS);
    self.emit('relation', endpoint.toString(), parents.last());
  });
  // Crude for now - if the wrangler finds a parent that would suggest some degree of success.
  var newState = parents.length > 0 ? states.infringements.state.UNVERIFIED : states.infringements.state.FALSE_POSITIVE;
  console.log('here 0 - about to emit infringementStateChange with %s and %i', infringement.uri, newState)
  self.emit('infringementStateChange', infringement, newState);
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
  
  // TODO refactor this out into separate promises.
  var buildPromises = function(error, results){
    if(error){
      loggger.error("GenericScraper: Can't fetch links that need scraping : %s", error);
      self.stop();
      return;
    }
    promiseArray = results.map(function promiseBuilder(infringement) {
      return self.checkinfringement.bind(self, infringement);
    });
    
    Promise.seq(promiseArray).then(function onInfringementsChecked() {
      // once all the selenium promises resolve, we can start our backup base-endpoint-wrangler run
      if (!!self.wrangler) { self.wrangler.quit(); self.wrangler = null }
      
      if (self.backupInfringements.length) {
        var backupPromiseArray = self.backupInfringements.map(function backupPromiseBuilder(infringement) {
          return self.backupCheckInfringement.bind(self, infringement);
        });

        logger.info('Starting backup run for ' + backupPromiseArray.length + ' infringements');
        Promise.seq(backupPromiseArray).then(function onBackupInfringementSChecked() {
          logger.info('Finished backup run');
          self.stop();
        });
      }
      else {
        self.stop();
      }
    });   
  }

  self.infringements.getNeedsScraping(campaign, buildPromises);
  self.emit('started');
};

Generic.prototype.onWranglerFinished = function (wrangler, infringement, promise, isBackup, items) {
  var self = this;
  wrangler.removeAllListeners();

  logger.info('found ' + items.length  + ' via the wrangler');
  items.each(function onFoundItem(foundItem) {
    var parents = foundItem.parents;
    var metadata = foundItem.items;
    metadata.isBackup = isBackup;
    self.emitInfringementStateChange(infringement, parents, metadata);
  });
  
  promise.resolve(items);
};

Generic.prototype.checkinfringement = function (infringement) {
  var self = this;
  function moveToBasicWrangler(thePromise, theInfringement){
    if (thePromise.finished)
      return; // nothing to do here.
    console.log("here - force quit that mother");
    self.wrangler.removeAllListeners();
    self.wrangler.quit();
    self.wrangler = null;
    self.backupInfringements.push(theInfringement);
    thePromise.resolve();    
  }

  var promise = new Promise.Promise();

  logger.info('Running check for: ' + infringement.uri);

  if (!self.wrangler) {
    self.driver = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                                         .withCapabilities(CAPABILITIES)
                                         .build();
    self.driver.manage().timeouts().implicitlyWait(30000);    
    self.wrangler = new Wrangler(self.driver);
    self.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
  }

  self.wrangler.on('finished', self.onWranglerFinished.bind(self, self.wrangler, infringement, promise, false));

  self.wrangler.on('error', function onWranglerError(error) {
    // wrangler died for some reason, we need to go for the backup solution
    logger.info('got error when scraping with selenium (' + infringement.uri + '): ' + error.toString());
    moveToBasicWrangler(promise);
  });
  // Provide a timeout so as if the browser hangs on some nasty page
  // push it to go for a backup solution
  moveToBasicWrangler.delay(120000, promise, infringement);
  self.driver.sleep(2000).then(self.wrangler.beginSearch(infringement.uri));
  return promise;
};

Generic.prototype.backupCheckInfringement = function (infringement) {
  var self = this;
  var promise = new Promise.Promise();
  var wrangler = new BasicWrangler();
  wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
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