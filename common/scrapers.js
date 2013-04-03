/*
 * scrapers.js: list of available scrapers
 *
 * (C) 2012 Ayatii Limited
 *
 * Scrapers compiles a cache of all the available scrapers so they can be easily
 * enumerated and started.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('scrapers.js')
  , path = require('path')
  , util = require('util')
  ;

var SCRAPERS_DIR = __dirname + '/scrapers';

var Scrapers = module.exports = function() {
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
    self.loadScraperInfo(path.join(SCRAPERS_DIR, file, '/package.json'));
  });

  self.removeScrapers();

  self.sortScrapers();

  self.ready_ = true;
  self.emit('ready');
}

Scrapers.prototype.loadScraperInfo = function(infopath) {
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

      scraper[type + '.regex'] = new RegExp(scraper.types[type]);
    }
  });
}

//
// Public
//
Scrapers.prototype.isReady = function() {
  return this.ready_;
}

Scrapers.prototype.getScraper = function(scraperName) {
  var self = this;
  var ret = null;

  self.scrapers_.forEach(function(scraper) {
    if (scraper.name == scraperName) {
      ret = scraper;
    }
  });

  return ret; 
}

Scrapers.prototype.getScrapers = function() {
  return this.scrapers_;
}

Scrapers.prototype.getScrapersForType = function(type, scope) {
  var self = this;

  var scrapers = this.scrapersByType_[type];
  if (scrapers !== undefined && scope !== undefined) {
    scrapers.remove(function(scraper) {
      return !scraper[type + '.regex'].test(scope);
    });
  }
  return scrapers;
}

Scrapers.prototype.getScraperTypes = function() {
  return Object.keys(this.scrapersByType_);
}

Scrapers.prototype.hasScraperForType = function(scraperName, types) {
  var self = this
    , type = types = types ? types : ""
    , scope = undefined
    ;

  if ((types = types.split('.')).length > 1) {
    type = types[0];
    scope = types[1];
  }

  var scrapers = self.scrapersByType_[type];
  if (!scrapers)
    return false;

  var ret = scrapers.find(function(scraper) {
    if (scraper.name === scraperName)
      return true;
  });

  if (ret) {
    if (scope) {
      return ret[type + '.regex'].test(scope);
    } else {
      return true;
    }
  }

  return false;
}

Scrapers.prototype.loadScraper = function(scrapername) {
  var modPath = SCRAPERS_DIR + '/' + scrapername;
  var Scraper = require(modPath);
  return new Scraper();
}