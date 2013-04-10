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
  , katparser = acquire('kat-parser')
  , isohuntparser = acquire('isohunt-parser')  
  , Storage = acquire('storage')
  , Promise = require('node-promise')
;

//TODO
//Align the various genres with our own campaign types so as automatic 
//query sorting can be determined from campaign type.
var Scraper = acquire('scraper');

var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };
var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 25;

var BittorrentPortal = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;
  self.results = [];
  self.storage = new Storage('torrent');
  self.campaign = campaign;
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); // waits 30000ms before erroring, gives pages enough time to load

  self.idleTime = [5, 10]; // min/max time to click next page
  self.resultsCount = 0;
  self.engineName = 'UNDEFINED';
  self.searchTerm = self.buildSearchQuery();
};

util.inherits(BittorrentPortal, events.EventEmitter);

BittorrentPortal.prototype.handleResults = function () {
  var self = this;
  self.remoteClient.sleep(2500);

  self.remoteClient.getPageSource().then(function sourceParser(source) {
    var newresults = self.getTorrentsFromResults(source);
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
        logger.info('managed to scrape ' + self.results.length + ' torrents');
        //self.cleanup();
        //self.getTorrentsDetails();
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
  var query = albumTitle.escapeURL(true);
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

BittorrentPortal.prototype.emitInfringements = function () {
  var self = this;
  self.results.each(function (torrent){
    self.emit('torrent',
               torrent.activeLink.uri,
               MAX_SCRAPER_POINTS / 2,
               {source: 'scraper.bittorrent' + self.engineName,
                message: 'Torrent page at ' + self.engineName,
                type: torrent.genre});
    self.emit('torrent',
               torrent.directLink,
               MAX_SCRAPER_POINTS / 1.5,
               {source: 'scraper.bittorrent.' + self.engineName,
                message: 'Link to actual Torrent file from ' + self.engineName,
                fileSize: torrent.fileSize,
                type: torrent.genre});
    self.emit('torrent',
               torrent.magnet,
               MAX_SCRAPER_POINTS / 1.25,
               {source: 'scraper.bittorrent.' + self.engineName,
                message: 'Torrent page at ' + self.engineName,
                fileSize: torrent.fileSize,
                type: torrent.genre});
    self.emit('relation', torrent.activeLink.uri, torrent.magnet);
    self.emit('relation', torrent.activeLink.uri, torrent.directLink);
    self.emit('torrent',
               torrent.hash_ID,
               MAX_SCRAPER_POINTS,
               {source: 'scraper.bittorrent' + self.engineName,
                message: 'Torrent hash scraped from ' + self.engineName,
                fileSize: torrent.fileSize, fileData: torrent.fileData.join(', '),
                type: torrent.genre});
    self.emit('relation', torrent.magnet, torrent.hash_ID);
    self.emit('relation', torrent.directLink, torrent.hash_ID);
    self.storage.createFromURL(torrent.name, torrent.directLink, {replace:false})
  });
  self.cleanup();
};

BittorrentPortal.prototype.beginSearch = function () {
  throw new Error('Stub!');
};

BittorrentPortal.prototype.getTorrentsFromResults = function (source) {
  throw new Error('Stub!');
};

BittorrentPortal.prototype.getTorrentsDetails = function (source) {
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
  self.searchQuery(1);//pageNumber
};

KatScraper.prototype.searchQuery = function(pageNumber){
  var self = this;
  var queryString = self.root +
                    '/usearch/' + 
                    self.searchTerm +  
                    '%20category%3Amusic/' + 
                    pageNumber + '/' + 
                    "?field=time_add&sorder=desc";
  self.remoteClient.get(queryString);
  self.remoteClient.findElement(webdriver.By.css('table.data')).then(function gotSearchResults(element) {
    if (element) {
      self.handleResults();
    }
    else {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
  });
}

KatScraper.prototype.getTorrentsDetails = function(){
  var self = this;
  function torrentDetails(torrent){
    var promise = new Promise.Promise;
    self.remoteClient.sleep(1000 * Number.random(1,5));
    self.remoteClient.get(torrent.activeLink.uri);
    self.remoteClient.getPageSource().then(function(source){
      katparser.torrentPage(source, torrent);
      promise.resolve();
    });
    return promise;
  }
  var promiseArray;
  promiseArray = self.results.map(function(r){ return torrentDetails.bind(self, r)});
  Promise.seq(promiseArray).then(function(){
    self.emitInfringements();
  }); 
}

KatScraper.prototype.getTorrentsFromResults = function (source) {
  var self = this;
  return katparser.resultsPage(source, self.campaign);
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

/* -- ISOHunt Scraper */
var IsoHuntScraper = function (campaign) {
  var self = this;
  self.constructor.super_.call(self, campaign);
  self.engineName = 'isohunt';
  self.root = 'http://www.isohunt.com';
};

util.inherits(IsoHuntScraper, BittorrentPortal);

IsoHuntScraper.prototype.beginSearch = function () {
  var self = this;
  self.resultsCount = 0;
  self.emit('started');
  self.remoteClient.get(self.root); 
  self.remoteClient.sleep(2000);
  self.searchQuery(1);//pageNumber
};

IsoHuntScraper.prototype.searchQuery = function(pageNumber){
  var self = this;
  var categoryID = 2;
  var queryString = self.root + 
                    '/torrents/' + 
                    self.searchTerm + '?' +
                    'iht=' + categoryID +
                    '&ihp=' + pageNumber +
                    '&ihs1=5&iho1=d';
  self.remoteClient.get(queryString);
  self.remoteClient.findElement(webdriver.By.css('table#serps')).then(function gotSearchResults(element) {
    if (element) {
      self.handleResults();
    }
    else {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
  });
}

IsoHuntScraper.prototype.getTorrentsDetails = function(){
  var self = this;
  function torrentDetails(torrent){
    var promise = new Promise.Promise;
    self.remoteClient.sleep(1000 * Number.random(1,5));
    self.remoteClient.get(torrent.activeLink.uri);
    self.remoteClient.getPageSource().then(function(source){
      isohuntparser.torrentPage(source, torrent);
      promise.resolve();
    });
    return promise;
  }
  var promiseArray;
  promiseArray = self.results.map(function(r){ return torrentDetails.bind(self, r)});
  Promise.seq(promiseArray).then(function(){
    self.emitInfringements();
  }); 
}

IsoHuntScraper.prototype.getTorrentsFromResults = function (source) {
  var self = this;
  return isohuntparser.resultsPage(source, self.campaign);
};

IsoHuntScraper.prototype.nextPage = function (source) {
  var self = this;
  var result = isohuntparser.paginationDetails(source);
  self.searchQuery(result.currentPage + 1);
};

IsoHuntScraper.prototype.checkHasNextPage = function (source) {
  return false;
  var self = this;
  var result = isohuntparser.paginationDetails(source);
  if(result.otherPages.isEmpty() || (result.otherPages.max() < result.currentPage))
    return false;
  return false; // TODO 
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
    'isohunt' : IsoHuntScraper
  };

  logger.info('Loading search engine: %s', job.metadata.engine);
  self.scraper = new scraperMap[job.metadata.engine](campaign);

  self.scraper.on('finished', function onFinished() {
    self.emit('finished');
  });

  self.scraper.on('error', function onError(err) {
    // do nuffink right now, handled elsewhere
  });

  self.scraper.on('torrent', function onFoundTorrent(uri, points, metadata){
    self.emit('infringement', uri, points, metadata);
  });

  self.scraper.on('relation', function onFoundRelation(parent, child){
    self.emit('relation', parent, child);
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