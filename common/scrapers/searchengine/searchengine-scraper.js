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
  , logger = acquire('logger').forFile('searchengine-scraper.js')
  , util = require('util')
  , webdriver = require('selenium-webdriver')
  , sugar = require('sugar')
  , cheerio = require('cheerio')
  , request = require('request')
  , URI = require('URIjs')
  ;

var Scraper = acquire('scraper')
  , Settings = acquire('settings')
  ;

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' };
var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 50;

var GenericSearchEngine = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;
  self.campaign = campaign;
  self.remoteClient = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  self.remoteClient.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load
  self.settings = new Settings('scraper.searchengine');
  
  self.idleTime = [5, 10]; // min/max time to click next page
  self.resultsCount = 0;
  self.engineName = 'UNDEFINED';
  self.maxPages = campaign.metadata.searchengineMaxPages ? campaign.metadata.searchengineMaxPages : 15;
  self.pageNumber = 1;

  if (!self.keywords) {
    if (Object.has(self.campaign.metadata, 'engineKeywords')) {
      self.keywords = self.campaign.metadata.engineKeywords;
    }
    else {
      self.keywords = [];
    }
  }
};
util.inherits(GenericSearchEngine, events.EventEmitter);


GenericSearchEngine.prototype.handleResults = function () {
  var self = this;
  // we sleep 1000ms first to let the page render
  self.remoteClient.sleep(2500);

  self.remoteClient.getPageSource().then(function sourceParser(source) {
    var newresults = self.getLinksFromSource(source);
    if (newresults.length < 1) {
      self.emit('error', ERROR_NORESULTS);
      self.cleanup();
    }
    else {
      self.emitLinks(newresults);

      if (self.checkHasNextPage(source)) {
        var randomTime = Number.random(self.idleTime[0], self.idleTime[1]);
        setTimeout(function () {
          self.nextPage();
        }, randomTime * 1000);
      }
      else {
        logger.info('finished scraping succesfully');
        self.cleanup();
      }
    }
  });
};

GenericSearchEngine.prototype.buildSearchQuery = function (done) {
  var self = this;
  var searchTerm = "";
  var queryBuilder = {
    'tv.live': self.buildSearchQueryTV.bind(self),
    'music.album': self.buildSearchQueryAlbum.bind(self),
    'music.track': self.buildSearchQueryTrack.bind(self),
    "movie": self.buildSearchQueryMovie.bind(self)
  };

  if (!Object.has(queryBuilder, self.campaign.type)) {
    self.emit('error', new Error('Campaign is of non excepted type: ' + self.campaign.type));
    done(null, self.campaign.name);
  }
  else {
    queryBuilder[self.campaign.type](done);
  }
};

GenericSearchEngine.prototype.buildSearchQueryTV = function (done) {
 var self = this
    , fmt = util.format
    , channelName = self.campaign.metadata.channelName
    , key = fmt('%s.%s.runNumber', self.engineName, self.campaign.name)
    , searchTerms = []
    ;

  searchTerms.push(fmt('%s watch online'));
  searchTerms.push(fmt('%s watch live online'));
  searchTerms.push(fmt('%s watch live online free'));
  searchTerms.push(fmt('%s live online'));
  searchTerms.push(fmt('%s live stream'));
  searchTerms.push(fmt('%s live stream free'));
  searchTerms.push(fmt('%s free online stream'));
  
  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);

    done(null, searchTerms[run % searchTerms.length]);
  });  
};


// Remove terms whose prefix already is in the terms array
// i.e. ["Foo Bar", "Foo Bar (remix)"] => ["Foo Bar"]
// This avoids us hitting search term limits on search engines
GenericSearchEngine.prototype.removeRedundantTerms = function(terms) {
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

GenericSearchEngine.prototype.buildSearchQueryTrack = function (done) {
  var self = this;
  var trackTitle = self.campaign.metadata.albumTitle;
  var artist = self.campaign.metadata.artist;

  var query = util.format('"%s" "%s" %s', artist, trackTitle, self.keywords.join(' '));
  done(null, query);
};

GenericSearchEngine.prototype.buildSearchQueryMovie = function(done) {
  var self = this
    , movieTitle = self.campaign.metadata.movieTitle
    , year = self.campaign.metadata.year
    , fmt = util.format
    , key = fmt('%s.%s.runNumber', self.engineName, self.campaign.name)
    , searchTerms = []
    , searchTerms1 = []
    , searchTerms2 = []
    , searchTerms3 = []
    , language = self.campaign.metadata.language
    ;

  searchTerms1.push(fmt('%s movie download', movieTitle));
  searchTerms2.push(fmt('%s %s movie download', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s movie download', movieTitle, language));

  searchTerms1.push(fmt('%s movie torrent', movieTitle));
  searchTerms2.push(fmt('%s %s movie torrent', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s movie torrent', movieTitle, language));

  searchTerms1.push(fmt('%s watch online', movieTitle));
  searchTerms2.push(fmt('%s %s watch online', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s watch online', movieTitle, language));

  searchTerms1.push(fmt('%s online free', movieTitle));
  searchTerms2.push(fmt('%s %s online free', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s online free', movieTitle, language));

  searchTerms1.push(fmt('%s free download', movieTitle));
  searchTerms2.push(fmt('%s %s free download', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s free download', movieTitle, language));

  ['bdrip', '720p', 'screener', 'dvdrip', 'cam'].forEach(function(type) {
    searchTerms1.push(fmt('%s %s download', movieTitle, type));
    searchTerms2.push(fmt('%s %s %s download', movieTitle, year, type));
    if (language != 'english')
      searchTerms3.push(fmt('%s %s %s download', movieTitle, language, type));
  });

  // Compile the list
  searchTerms = searchTerms1.add(searchTerms2);
  searchTerms = searchTerms.add(searchTerms3);

  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);

    done(null, searchTerms[run % searchTerms.length]);
  });  
}

GenericSearchEngine.prototype.buildSearchQueryAlbum = function (done) {
  var self = this
    , albumTitle = self.campaign.metadata.albumTitle
    , artist = self.campaign.metadata.artist
    , fmt = util.format
    , key = fmt('%s.%s.runNumber', self.engineName, self.campaign.name)
    , searchTerms = []
    , searchTerms1 = []
    , searchTerms2 = []
    , soundtrack = self.campaign.metadata.soundtrack
    , tracks = self.campaign.metadata.tracks.map(getValFromObj.bind(null, 'title'))
    ;

  // First is the basic album searches
  if (soundtrack) {
    searchTerms1.push(fmt('%s song download', albumTitle));
    searchTerms1.push(fmt('%s mp3 torrent', albumTitle));
    searchTerms2.push(fmt('%s mp3', albumTitle));
  } else {
    searchTerms1.push(fmt('%s %s download', artist, albumTitle));
    searchTerms1.push(fmt('%s %s torrent', artist, albumTitle));
    searchTerms1.push(fmt('%s mp3', artist, albumTitle));
  }

  // Now the tracks
  tracks.forEach(function(track) {
    if (soundtrack) {
      searchTerms1.push(fmt('%s song download', track));
      searchTerms2.push(fmt('%s mp3', track));
    } else {
      searchTerms1.push(fmt('%s %s song download', artist, track));
      searchTerms2.push(fmt('%s %s mp3', artist, track));
    }
  });

  // Compile the list
  searchTerms = searchTerms1.add(searchTerms2);

  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);

    done(null, searchTerms[run % searchTerms.length]);
  });
};


GenericSearchEngine.prototype.cleanup = function () {
  this.emit('finished');
  this.remoteClient.quit();
};

GenericSearchEngine.prototype.emitLinks = function (linkList) {
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

GenericSearchEngine.prototype.beginSearch = function () {
  throw new Error('Stub!');
};


GenericSearchEngine.prototype.getLinksFromSource = function (source) {
  throw new Error('Stub!');
};

// clicks on the next page, waits for new results
GenericSearchEngine.prototype.nextPage = function () {
  throw new Error('Stub!');
};

GenericSearchEngine.prototype.checkHasNextPage = function (source) {
  throw new Error('Stub!');
};

/* -- Google Scraper */
var GoogleScraper = function (campaign) {
  var self = this;
  //self.keywords = campaign.type.has('live') ? '~live ~stream' : '~free ~download';

  self.constructor.super_.call(self, campaign);
  self.engineName = 'google';
};

util.inherits(GoogleScraper, GenericSearchEngine);


GoogleScraper.prototype.beginSearch = function () {
  var self = this;
  self.resultsCount = 0;
  self.emit('started');

  self.buildSearchQuery(function(err, searchTerm) {
    if (err)
      return self.emit('error', err);

    self.searchTerm = searchTerm;

    self.remoteClient.get('http://www.google.com'); // start at google.com

    self.remoteClient.findElement(webdriver.By.css('input[name=q]')) //finds <input name='q'>
    .sendKeys(self.searchTerm); // types out our search term into the input box

    // just submit the query for now
    self.remoteClient.findElement(webdriver.By.css('input[name=q]')).submit();
    logger.info('searching google with search query: ' + self.searchTerm);

    // waits for a #search selector
    self.remoteClient.findElement(webdriver.By.css('#search')).then(function gotSearchResults(element) {
      if (element) {
        self.handleResults();
      }
      else {
        self.emit('error', ERROR_NORESULTS);
        self.cleanup();
      }
    });
  });
};


GoogleScraper.prototype.getLinksFromSource = function (source) {
  var links = [];
  var $ = cheerio.load(source);
  $('#search').find('#ires').find('#rso').children().each(function () {
    links.push($(this).find('a').attr('href'));
  });
  return links;
};

// clicks on the next page, waits for new results
GoogleScraper.prototype.nextPage = function () {
  var self = this;

  self.pageNumber += 1;
  if (self.pageNumber > self.maxPages) {
    logger.info('Reached maximum of %d pages', self.maxPages);
    self.cleanup();
    return;
  }

  // clicks the next page element.
  self.remoteClient.findElement(webdriver.By.css('#pnnext')).click().then(function () { self.handleResults(); });
};

GoogleScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a#pnnext').length < 1) { return false; }
  return true;
};

/* -- Yahoo Scraper -- */
var YahooScraper = function (campaign) {
  var self = this;

  self.constructor.super_.call(self, campaign);

  self.engineName = 'yahoo';
};

util.inherits(YahooScraper, GenericSearchEngine);


YahooScraper.prototype.beginSearch = function () {
  var self = this;
  self.emit('started');

  self.buildSearchQuery(function(err, searchTerm) {
    if (err)
      return self.emit('error', err);

    self.searchTerm = searchTerm;
    self.remoteClient.get('http://www.yahoo.com'); // start at yahoo.com

    self.remoteClient.findElement(webdriver.By.css('input[name=p]')) //finds <input name='q'>
    .sendKeys(self.searchTerm); // types out our search term into the input box

    // find our search button, once we find it we build an action sequence that moves the cursor to the button and clicks
    self.remoteClient.findElement(webdriver.By.css('input[name=p]')).submit();

    logger.info('searching Yahoo with search query: ' + self.searchTerm);

    // waits for a #search selector
    self.remoteClient.findElement(webdriver.By.css('div#web')).then(function gotSearchResults(element) {
      if (element) {
        self.handleResults();
      }
      else {
        self.emit('error', ERROR_NORESULTS);
        self.cleanup();
      }
    });
  });
};

YahooScraper.prototype.getLinksFromSource = function (source) {
  var links = [];
  var $ = cheerio.load(source);
  $('div#web').find('ol').children('li').each(function () {
    links.push($(this).find('a').attr('href'));
  });
  return links;
};

// clicks on the next page, waits for new results
YahooScraper.prototype.nextPage = function () {
  var self = this;

  self.pageNumber += 1;
  if (self.pageNumber > self.maxPages) {
    logger.info('Reached maximum of %d pages', self.maxPages);
    self.cleanup();
    return;
  }

  // clicks the next page element.
  self.remoteClient.findElement(webdriver.By.css('a#pg-next')).click().then(function () { self.handleResults(); });
};

YahooScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a#pg-next').length < 1) { return false; }
  return true;
};

/* -- Bing Scraper -- */
var BingScraper = function (campaign) {
  var self = this;
  self.constructor.super_.call(self, campaign);

  self.engineName = 'bing';
};

util.inherits(BingScraper, GenericSearchEngine);


BingScraper.prototype.beginSearch = function () {
  var self = this;
  self.emit('started');
  self.buildSearchQuery(function(err, searchTerm) {
    if (err)
      return self.emit('error', err);

    self.searchTerm = searchTerm;
    self.remoteClient.get('http://www.bing.com'); // start at bing

    self.remoteClient.findElement(webdriver.By.css('input[id=sb_form_q]')) //finds <input name='q'>
    .sendKeys(self.searchTerm); // types out our search term into the input box

    // find our search button, once we find it we build an action sequence that moves the cursor to the button and clicks
    self.remoteClient.findElement(webdriver.By.css('input#sb_form_go')).submit();

    logger.info('searching Bing with search query: ' + self.searchTerm);

    // waits for a #search selector
    self.remoteClient.findElement(webdriver.By.css('div#results')).then(function gotSearchResults(element) {
      if (element) {
        self.handleResults();
      }
      else {
        self.emit('error', ERROR_NORESULTS);
        self.cleanup();
      }
    });
  });
};

BingScraper.prototype.getLinksFromSource = function (source) {
  var links = [];
  var $ = cheerio.load(source);
  $('#results').find('ul#wg0').children('li.sa_wr').each(function () {
    links.push($(this).find('a').attr('href'));
  });
  return links;
};

// clicks on the next page, waits for new results
BingScraper.prototype.nextPage = function () {
  var self = this;

  self.pageNumber += 1;
  if (self.pageNumber > self.maxPages) {
    logger.info('Reached maximum of %d pages', self.maxPages);
    self.cleanup();
    return;
  }

  // clicks the next page element.
  self.remoteClient.findElement(webdriver.By.css('a.sb_pagN')).click().then(function () { self.handleResults(); });
};

BingScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a.sb_pagN').length < 1) { return false; }
  return true;
};

/* -- Filestube Scraper */
var FilestubeScraper = function (campaign) {
  var self = this;
  self.constructor.super_.call(self, campaign);
  self.engineName = 'filestube';
  self.apikey = '051b6ec16152e2a74da5032591e9cc84';
};

util.inherits(FilestubeScraper, GenericSearchEngine);

FilestubeScraper.prototype.buildSearchQuery = function (done) {
  var self = this;
  var searchTerms = [];
  var key = util.format('%s.%s.runNumber', self.engineName, self.campaign.name)
  var tracks = self.campaign.metadata.tracks.map(getValFromObj.bind(null, 'title'))
  searchTerms.push(util.format('%s %s', 
                         self.campaign.metadata.artist,
                         self.campaign.metadata.albumTitle));
  tracks.each(function(trackTitle){
    searchTerms.push(util.format('%s %s'), self.campaign.metadata.artist, trackTitle);
  });

  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);
    done(null, searchTerms[run % searchTerms.length]);
  });
}

FilestubeScraper.prototype.beginSearch = function () {
  var self = this;
  self.resultsCount = 0;
  self.emit('started');
  self.buildSearchQuery(function(err, searchTerm) {
    if (err)
      return self.emit('error', err);
    self.searchTerm = searchTerm;
    var requestURI = "http://api.filestube.com/?key=" + 
                      self.apikey + 
                      '&phrase=' + URI.encode(self.searchTerm);
    logger.info('about to search filestube with this query ' + requestURI);
    request(requestURI, {}, self.getLinksFromSource.bind(self));
  });
};

FilestubeScraper.prototype.getLinksFromSource = function (err, resp, html) {
  var self = this;
  var links = [];
  var $ = cheerio.load(html);
  logger.info('filestube has found ' + $('hasResults').text() + ' answers');
  $('link').each(function(){
    links.push($(this).text());
  })
  self.emitLinks(links);
};

/* Scraper Interface */
var SearchEngine = module.exports = function () {
  this.sourceName_ = 'searchengine';
  this.init();
};
util.inherits(SearchEngine, Scraper);

SearchEngine.prototype.init = function () {
  var self = this;
};

//
// Overrides
//
SearchEngine.prototype.getName = function () {
  return "SearchEngine";
};

SearchEngine.prototype.getSourceName = function () {
  return this.sourceName_;
};

SearchEngine.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign.name);
  var scraperMap = {
    'google': { klass: GoogleScraper, sourceName: 'searchengine.google' },
    'yahoo': { klass: YahooScraper, sourceName: 'searchengine.bing' }, // Results come from bing
    'bing': { klass: BingScraper, sourceName: 'searchengine.bing' },
    'filestube': { klass: FilestubeScraper, sourceName: 'searchengine.filestube' }
  };

  logger.info('Loading search engine: %s', job.metadata.engine);
  self.scraper = new scraperMap[job.metadata.engine].klass(campaign);
  self.sourceName_ = scraperMap[job.metadata.engine].sourceName;

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

SearchEngine.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

SearchEngine.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};

//
// Utils
//
function getValFromObj(key, obj) {
  return obj[key];
}