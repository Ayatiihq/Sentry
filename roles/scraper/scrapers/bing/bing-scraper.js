"use strict"; 
/*
 * bing-scraper.js: a google scraper
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
  , logger = acquire('logger').forFile('bing-scraper.js')
  , util = require('util')
  , webdriver = require('selenium-webdriverjs')
  , sugar = require('sugar')
  , cheerio = require('cheerio')
  ;

var Scraper = acquire('scraper');

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' };
var ERROR_NORESULTS = "No search results found after searching";

/* BingScraper - is an event emitter object 
    'finished' - scraper is finished scraping google
    'started' - scraper started scraping.
    'found-link'(string - uri) - scraper found a link in the search results
    'error'(error) - scraper found an error, includes the error
*/

var BingScraper = function (searchTerm) {
  events.EventEmitter.call(this);
  this.remoteClient = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  this.remoteClient.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load

  this.searchTerm = searchTerm;
  this.idleTime = [5, 10]; // min/max time to click next page
};

util.inherits(BingScraper, events.EventEmitter);

BingScraper.prototype.beginSearch = function () {
  var self = this;
  try {
    self.emit('started');
    this.remoteClient.get('http://www.bing.com'); // start at google.com

    this.remoteClient.findElement(webdriver.By.css('input[id=sb_form_q]')) //finds <input name='q'>
    .sendKeys(self.searchTerm); // types out our search term into the input box

    // find our search button, once we find it we build an action sequence that moves the cursor to the button and clicks
    this.remoteClient.findElement(webdriver.By.css('input#sb_form_go')).submit();

    // waits for a #search selector
    this.remoteClient.findElement(webdriver.By.css('div#results')).then(function gotSearchResults(element) {
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

BingScraper.prototype.handleResults = function () {
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
        self.cleanup();
      }
    }
  });
};

BingScraper.prototype.emitLinks = function (linkList) {
  var self = this;
  linkList.each(function linkEmitter(link) {
    self.emit('found-link', link);
  });
};

BingScraper.prototype.getLinksFromSource = function (source) {
  var links = [];
  var $ = cheerio.load(source);
  $('#results').find('ul#wg0').children().each(function () {
    links.push($(this).find('a').attr('href'));
  });
  return links;
};

// clicks on the next page, waits for new results
BingScraper.prototype.nextPage = function () {
  var self = this;
  // clicks the next page element.
  try {
    self.remoteClient.findElement(webdriver.By.css('a.sb_pagN')).click().then(function () { self.handleResults(); });
  } 
  catch (err) {
    self.emit('error', err);
    logger.warn("Error encountered when scraping google: %s", err.toString());
  }
};

BingScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a.sb_pagN').length < 1) { return false; }
  return true;
};


BingScraper.prototype.cleanup = function () {
  this.emit('finished');
  this.remoteClient.quit();
};


var Bing = module.exports = function () {
  this.init();
};

util.inherits(Bing, Scraper);

Bing.prototype.init = function () {
  var self = this;
};

//
// Overrides
//
Bing.prototype.getName = function () {
  return "Bing";
};

Bing.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign.name);
  self.scraper = new BingScraper(campaign.name);

  self.scraper.on('finished', function onFinished() {
    self.emit('finished');
  });

  self.scraper.on('error', function onError(err) {
    // do nuffink right now, handled elsewhere
  });

  self.scraper.on('found-link', function onFoundLink(link) {
    self.emit('metaInfringement', link);
  });


  self.scraper.beginSearch();
  self.emit('started');
};

Bing.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Bing.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};