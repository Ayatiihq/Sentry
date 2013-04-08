"use strict";
/*
 * bittorrent-scraper.js
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('bittorrent-scraper.js')
  , util = require('util')
  , webdriver = require('selenium-webdriver')
  , sugar = require('sugar')
  , cheerio = require('cheerio')
  , URI = require('URIjs')  
  , Settings = acquire('settings')  
  , Spidered = acquire('spidered').Spidered 
  , SpideredStates = acquire('spidered').SpideredStates    
  , katparser = acquire('kat-parser')
;

var Scraper = acquire('scraper');

var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };
var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 20;

var BittorrentPortal = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;
  self.results = [];
  self.campaign = campaign;
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); // waits 10000ms before erroring, gives pages enough time to load

  self.idleTime = [5, 10]; // min/max time to click next page
  self.resultsCount = 0;
  self.engineName = 'UNDEFINED';

  if (!self.keywords) {
    if (Object.has(self.campaign.metadata, 'engineKeywords')) {
      self.keywords = self.campaign.metadata.engineKeywords;
    }
    else {
      self.keywords = [];
    }
  }
  self.searchTerm = self.buildSearchQuery();
};

util.inherits(BittorrentPortal, events.EventEmitter);

BittorrentPortal.prototype.handleResults = function () {
  var self = this;
  self.remoteClient.sleep(2500);

  self.remoteClient.getPageSource().then(function sourceParser(source) {
    var newresults = self.getLinksFromSource(source);
    self.results = self.results.union(newresults);
    if (newresults.length < 1 && self.results.isEmpty()) {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
    else {
      if (self.checkHasNextPage(source)) {
        var randomTime = Number.random(self.idleTime[0], self.idleTime[1]);
        setTimeout(function () {
          self.nextPage(source);
        }, randomTime * 1000);
      }
      else {
        console.log('managed to scrape ' + self.results.length + ' results');
        self.cleanup();
      }
    }
  });
};

BittorrentPortal.prototype.buildSearchQuery = function () {
  var self = this;
  var queryBuilder = {
    'tv.live': self.buildSearchQueryTV.bind(self),
    'music.album': self.buildSearchQueryAlbum.bind(self),
    'music.track': self.buildSearchQueryTrack.bind(self)
  };

  if (!Object.has(queryBuilder, self.campaign.type)) {
    self.emit('error', new Error('Campaign is of non excepted type: ' + self.campaign.type));
    return self.campaign.name;
  }
  else {
    return queryBuilder[self.campaign.type]();
  }
};

BittorrentPortal.prototype.buildSearchQueryTV = function () {
  var self = this;
  return self.campaign.name;
};

BittorrentPortal.prototype.buildSearchQueryAlbum = function () {
  var self = this;
  var albumTitle = self.campaign.metadata.albumTitle;
  var query = albumTitle.replace(/\s/, '%20') + '%20category%3Amusic/';
  return query;
};

BittorrentPortal.prototype.buildSearchQueryTrack = function () {
  var self = this;
  var trackTitle = self.campaign.metadata.albumTitle;
  var artist = self.campaign.metadata.artist;

  var query = util.format('"%s" "%s" %s', artist, trackTitle, self.keywords.join(' '));
  return query;
};

BittorrentPortal.prototype.cleanup = function () {
  this.emit('finished');
  this.remoteClient.quit();
};

BittorrentPortal.prototype.emitLinks = function (linkList) {
  var self = this;

  linkList.each(function linkEmitter(link) {
    if (link[0] === '/') { return; }

    var linkScore = Math.max(1.0, MAX_SCRAPER_POINTS * (1.0 - self.resultsCount / 100));

    self.emit('found-link', link,
      {
        engine: self.engineName,
        score: linkScore,
        message: "Engine result",
        source: 'scraper.' + self.engineName
      });

    self.resultsCount++;
  });
};

BittorrentPortal.prototype.beginSearch = function () {
  throw new Error('Stub!');
};

BittorrentPortal.prototype.getLinksFromSource = function (source) {
  throw new Error('Stub!');
};

// clicks on the next page, waits for new results
BittorrentPortal.prototype.nextPage = function () {
  throw new Error('Stub!');
};

BittorrentPortal.prototype.checkHasNextPage = function (source) {
  throw new Error('Stub!');
};

/* -- KAT Scraper */
var KatScraper = function (campaign) {
  var self = this;
  //self.keywords = campaign.type.has('live') ? '~live ~stream' : '~free ~download';

  self.constructor.super_.call(self, campaign);
  self.engineName = 'kat';
  self.root = 'http://www.katproxy.com';
};

util.inherits(KatScraper, BittorrentPortal);

KatScraper.prototype.beginSearch = function () {
  var self = this;
  self.resultsCount = 0;
  self.emit('started');
  self.remoteClient.get(self.root); 
  self.remoteClient.sleep(2000);
  self.searchQuery(1);
};

KatScraper.prototype.searchQuery = function(pageNumber){
  var self = this;
  var queryString = self.root + '/usearch/' + self.searchTerm + pageNumber + '/' + "?field=time_add&sorder=desc";
  this.remoteClient.get(queryString);
  this.remoteClient.findElement(webdriver.By.css('table.data')).then(function gotSearchResults(element) {
    if (element) {
      self.handleResults();
    }
    else {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
  });
}

KatScraper.prototype.getLinksFromSource = function (source) {
  var self = this;
  return katparser.resultsPage(source);
};

KatScraper.prototype.nextPage = function (source) {
  var self = this;
  var result = katparser.paginationDetails(source);
  self.searchQuery(result.currentPage + 1);
};

KatScraper.prototype.checkHasNextPage = function (source) {
  var self = this;
  var result = katparser.paginationDetails(source);
  if(result.otherPages.isEmpty() || (result.otherPages.max() < result.currentPage))
    return false;
  return true;
};

/* Scraper Interface */
var Bittorrent = module.exports = function () {
  this.init();
};
util.inherits(Bittorrent, Scraper);

Bittorrent.prototype.init = function () {
  var self = this;
};

//
// Overrides
//
Bittorrent.prototype.getName = function () {
  return "Bittorrent";
};

Bittorrent.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign.name);
  var scraperMap = {
    'kat': KatScraper,
  };

  logger.info('Loading search engine: %s', job.metadata.engine);
  self.scraper = new scraperMap[job.metadata.engine](campaign);

  self.scraper.on('finished', function onFinished() {
    self.emit('finished');
  });

  self.scraper.on('error', function onError(err) {
    // do nuffink right now, handled elsewhere
  });

  self.scraper.on('found-link', function onFoundLink(link, points) {
    self.emit('metaInfringement', link, points);
  });

  self.scraper.beginSearch();
  self.emit('started');
};

Bittorrent.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Bittorrent.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};