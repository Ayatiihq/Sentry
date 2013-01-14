/*
 * scrapers.js: list of available scrapers
 *
 * (C) 2012 Ayatii Limited
 *
 * Scrapers compiles a cache of all the available scrapers so they can be easily
 * enumerated and started.
 *
 */

var cluster = require('cluster')
  , config = require('../config')
  , events = require('events')
  , fs = require('fs')
  , logger = require('../logger').forFile('scrapers.js')
  , path = require('path')
  , util = require('util')
  ;

var SCRAPERS_DIR = path.dirname(module.filename) + '/scraper/scrapers';

var Scrapers = exports.Scrapers = function() {
  this.ready_ = false;
  this.scrapers_ = [];
  this.scrapersByType_ = {};

  this.init();
}

util.inherits(Scrapers, events.EventEmitter);

Scrapers.prototype.init = function() {
  var self = this;

  console.log("Reading modules from: " + SCRAPERS_DIR);

  // Works from toplevel
  fs.readdir(SCRAPERS_DIR, self.onScrapersDirRead.bind(self));
}

Scrapers.prototype.onScrapersDirRead = function(err, files) {
  var self = this;

  if (err) {
    console.warn(err);
    return;
  }

  files.forEach(function(file) {
    if (file.endsWith('.js'))
      return;
    self.loadScraper(path.join(SCRAPERS_DIR, file, '/package.json'));
  });

  self.removeScrapers();

  self.sortScrapers();

  self.ready_ = true;
  self.emit('ready');
}

Scrapers.prototype.loadScraper = function(infopath) {
  var self = this;

  logger.info('Loading scraper: ' + infopath);

  try {
    var scraper = require(infopath);

    self.scrapers_.push(scraper);

  } catch (error) {
    logger.warn('Unable to load scraper: ' + infopath + ': ' + error);
  }
}

Scrapers.prototype.removeScrapers = function() {
  var self = this;
  
  // Remove scrapers that
  // - Do not apply to this platform

  config.EXCLUDE_SCRAPERS.forEach(function(scraperid) {
    self.scrapers_.remove(function(scraper) {
      return scraper.name === scraperid;
    });
  });

  if (config.INCLUDE_SCRAPERS.length > 0) {
    self.scrapers_.remove(function(scraper) {
      return config.INCLUDE_SCRAPERS.findIndex(scraper.name) === -1;
    });
  }
}

Scrapers.prototype.sortScrapers = function() {
  var self = this;

  self.scrapers_.forEach(function(scraper) {
    /* Put the scraper into the appropriete arrays */
    var types = Object.keys(scraper.types);
    for (var i = 0; i < types.length; i++) {
      var type = types[i];

      if (!Object.has(self.scrapersByType_, type)) {
        self.scrapersByType_[type] = [];
      }
      self.scrapersByType_[type].push(scraper);
    }
  });
}

//
// Public
//
Scrapers.prototype.isReady = function() {
  return this.ready_;
}

Scrapers.prototype.getScrapers = function() {
  return this.scrapers_;
}

Scrapers.prototype.getScrapersForType = function(type) {
  return this.scrapersByType_[type];
}

Scrapers.prototype.getScraperTypes = function() {
  return Object.keys(this.scrapersByType_);
}