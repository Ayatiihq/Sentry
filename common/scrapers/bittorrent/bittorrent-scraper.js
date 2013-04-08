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
;

var Scraper = acquire('scraper');

var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };
var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 20;

var BittorrentPortal = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;
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
    if (newresults.length < 1) {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
    else {
      self.emitLinks(newresults);
      /*if (self.checkHasNextPage(source)) {
        var randomTime = Number.random(self.idleTime[0], self.idleTime[1]);
        setTimeout(function () {
          self.nextPage();
        }, randomTime * 1000);
      }*/
      //else {
      logger.info('finished scraping succesfully');
      self.cleanup();
      //}
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

// Remove terms whose prefix already is in the terms array
// i.e. ["Foo Bar", "Foo Bar (remix)"] => ["Foo Bar"]
// This avoids us hitting search term limits on search engines
BittorrentPortal.prototype.removeRedundantTerms = function(terms) {
  var self = this
    , ret = []
    ;

  terms.forEach(function(term) {
    var hasPrefix = false;
    ret.forEach(function(prefix) {
      if (term.indexOf(prefix) == 0)
        hasPrefix = true;
    });

    if (!hasPrefix)
      ret.push(term);
  });

  return ret;
}

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
};

util.inherits(KatScraper, BittorrentPortal);

KatScraper.prototype.beginSearch = function () {
  var self = this;
  self.resultsCount = 0;
  self.emit('started');
  self.root = 'http://www.katproxy.com';
  this.remoteClient.get(self.root); 
  this.remoteClient.sleep(2000);
  console.log('about to request : '
              + self.root +
              '/usearch/' +
              self.searchTerm);
  this.remoteClient.get(self.root + '/usearch/' + self.searchTerm + "?field=time_add&sorder=desc");
  // just submit the query for now
  // waits for a #search selector
  this.remoteClient.findElement(webdriver.By.css('table.data')).then(function gotSearchResults(element) {
    if (element) {
      self.handleResults();
    }
    else {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
  });
};

KatScraper.prototype.getLinksFromSource = function (source) {
  var self = this;
  var links = [];
  var $ = cheerio.load(source);

  function testAttr($$, attrK, test){
    return $$(this).attr(attrK) && $$(this).attr(attrK).match(test);
  }

  $('tr').each(function(){
    var magnet = null;
    var fileLink = null;
    var torrentName = null;
    var size = null;
    var entityLink = null;
    var roughDate = null;

    if(testAttr.call(this, $, 'id', /torrent_*/)){
      $(this).find('a').each(function(){
        if(testAttr.call(this, $, 'title', /Torrent magnet link/))
          magnet = $(this).attr('href');
        if(testAttr.call(this, $, 'title', /Download torrent file/))
          fileLink = $(this).attr('href');
        // TODO there are other 'choices' which i have yet to capture - 1 in 50 or so fails.
        if(testAttr.call(this, $, 'class', /^torType (undefined|movie|film|music)Type$/)){
          try{
            var inst = URI($(this).attr('href'));
            entityLink = inst.absoluteTo(self.root).toString();
          }
          catch(err){
            logger.warn('failed to create valid entity link : ' + err);
          }
        }
        if(testAttr.call(this, $, 'class', 'normalgrey font12px plain bold'))
          torrentName = $(this).text();
      });
      // grab the size and figure out the date.
      $(this).find('td').each(function(){
        if(testAttr.call(this, $, 'class', 'nobr center')){
          size = $(this).text();
          var age = $(this).next().next().text().trim();
          var context = {'Minutes': age.match(/min\./),
                         'Hours': age.match(/hour(s)?/),
                         'Days': age.match(/day(s)?/),
                         'Weeks': age.match(/week(s)?/),
                         'Months': age.match(/month(s)?/),
                         'Years': age.match(/year(s)?/)};
          var offsetLiteral;
          // its gotta be one and only one !            
          Object.keys(context).each(function(key){ if(context[key] !== null) offsetLiteral = key ;});
          var offset;
          age.words(function(word){
            if(parseInt(word)) 
              offset = word;
          })            
          roughDate = Date.create()['add' + offsetLiteral](-offset);
        }
      });

      if(magnet && entityLink && torrentName){
        
        var torrent =  new Spidered('torrent',
                                     torrentName,
                                     null,
                                     entityLink,
                                     SpideredStates.ENTITY_PAGE_PARSING);              
        torrent.magnet = magnet;
        torrent.fileSize = size;
        torrent.date = roughDate;
        torrent.directLink = fileLink; // direct link to torrent via querying torcache
        //if(self.results.length === 0) // test with just the first (sort out sleep)
        links.push(torrent);
        console.log('just created : ' + JSON.stringify(torrent));
      }
      else{
        logger.warn('fail to create : ' + JSON.stringify({magnet: magnet,
                                                          fileSize: size,
                                                          date: roughDate,
                                                          file: fileLink,
                                                          name: torrentName,
                                                          link: entityLink}));
      }
    }
  });
  return links;
};

// clicks on the next page, waits for new results
KatScraper.prototype.nextPage = function () {
  var self = this;
  // clicks the next page element.
  //self.remoteClient.findElement(webdriver.By.css('#pnnext')).click().then(function () { self.handleResults(); });
};

KatScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  //if ($('a#pnnext').length < 1) { return false; }
  return false;
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