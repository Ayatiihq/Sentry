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
  , logger = acquire('logger').forFile('google-scraper.js')
  , util = require('util')
  , webdriver = require('selenium-webdriver')
  , sugar = require('sugar')
  , cheerio = require('cheerio')
  ;

var Scraper = acquire('scraper');

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' };
var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 7;

/* GoogleScraper - is an event emitter object 
    'finished' - scraper is finished scraping google
    'started' - scraper started scraping.
    'found-link'(string - uri) - scraper found a link in the search results
    'error'(error) - scraper found an error, includes the error
*/

//FIXME - do multiple searches with various search queries, will do after we get a base "this on its own works"
var GoogleScraper = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;

  self.campaign = campaign;

  self.remoteClient = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  self.remoteClient.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load

  self.searchTerm = self.buildSearchQuery();
  self.idleTime = [5, 10]; // min/max time to click next page
  self.resultCount;
};

util.inherits(GoogleScraper, events.EventEmitter);

GoogleScraper.prototype.buildSearchQuery = function () {
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

GoogleScraper.prototype.buildSearchQueryTV = function () {
  return self.campaign.name;
};

GoogleScraper.prototype.buildSearchQueryAlbum = function () {
  var self = this;
  function getVal(key, obj) { console.log(obj); return obj[key]; }

  var albumTitle = self.campaign.metadata.albumTitle;
  var artist = self.campaign.metadata.artist;
  var tracks = self.campaign.metadata.tracks.map(getVal.bind(null, 'title'));

  var trackQuery = ''; // builds 'track 1' OR 'track 2' OR 'track 3'
  tracks.each(function buildTrackQuery(track, index) { 
    if (index === tracks.length - 1) { trackQuery += util.format('"%s"', track); }
    else { trackQuery += util.format('"%s" OR ', track); }
  });

  var query = util.format('"%s" "%s" %s ~free ~download', artist, albumTitle, trackQuery);

  return query;
};

GoogleScraper.prototype.buildSearchQueryTrack = function () {
  var self = this;
  var trackTitle = self.campaign.metadata.albumTitle;
  var artist = self.campaign.metadata.artist;

  var query = util.format('"%s" "%s" ~free ~download', artist, trackTitle);
  return query;
};

GoogleScraper.prototype.beginSearch = function () {
  var self = this;
  self.resultsCount = 0;
  try {
    self.emit('started');
    this.remoteClient.get('http://www.google.com'); // start at google.com

    this.remoteClient.findElement(webdriver.By.css('input[name=q]')) //finds <input name='q'>
    .sendKeys(self.searchTerm); // types out our search term into the input box

    // just submit the query for now
    this.remoteClient.findElement(webdriver.By.css('input[name=q]')).submit();
    logger.info('searching google with search query: ' + self.searchTerm);

    // waits for a #search selector
    this.remoteClient.findElement(webdriver.By.css('#search')).then(function gotSearchResults(element) {
      if (element) {
        self.handleResults();
      }
      else {
        self.emit('error', ERROR_NORESULTS);
        self.cleanup();
      }
    });
  }
  catch (err) {
    self.emit('error', err);
    logger.warn("Error encountered when scraping google: %s", err.toString());
    self.cleanup();
  }
};

GoogleScraper.prototype.handleResults = function () {
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

GoogleScraper.prototype.emitLinks = function (linkList) {
  var self = this;
  logger.info('scraping results page...');
  console.log(self.resultsCount);
  console.log(MAX_SCRAPER_POINTS * (1.0 - self.resultsCount / 100));

  linkList.each(function linkEmitter(link) {
    self.emit('found-link', link, 
              {score: MAX_SCRAPER_POINTS * (1.0 - self.resultsCount / 100),
               message: "Google result",
               source: 'scraper.google'});

    self.resultsCount++;
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
  // clicks the next page element.
  try {
    self.remoteClient.findElement(webdriver.By.css('#pnnext')).click().then(function () { self.handleResults(); });
  } 
  catch (err) {
    self.emit('error', err);
    logger.warn("Error encountered when scraping google: %s", err.toString());
  }
};

GoogleScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a#pnnext').length < 1) { return false; }
  return true;
};


GoogleScraper.prototype.cleanup = function () {
  this.emit('finished');
  this.remoteClient.quit();
};


var Google = module.exports = function () {
  this.init();
};

util.inherits(Google, Scraper);

Google.prototype.init = function () {
  var self = this;
};

//
// Overrides
//
Google.prototype.getName = function () {
  return "Google";
};

Google.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign.name);
  self.scraper = new GoogleScraper(campaign);

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

Google.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Google.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};