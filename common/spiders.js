/*
 * spiders.js: list of available spiders
 *
 * (C) 2012 Ayatii Limited
 *
 * Spiders compiles a cache of all the available spiders so they can be easily
 * enumerated and started.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('spiders.js')
  , path = require('path')
  , util = require('util')
  ;

var SPIDERS_DIR = __dirname + '/spiders';

var Spiders = module.exports = function() {
  this.ready_ = false;
  this.spiders_ = [];
  this.spidersByType_ = {};

  this.init();
}

util.inherits(Spiders, events.EventEmitter);

Spiders.prototype.init = function() {
  var self = this;

  console.log("Reading modules from: " + SPIDERS_DIR);

  // Works from toplevel
  fs.readdir(SPIDERS_DIR, self.onSpidersDirRead.bind(self));
}

Spiders.prototype.onSpidersDirRead = function(err, files) {
  var self = this;

  if (err) {
    console.warn(err);
    return;
  }

  files.forEach(function(file) {
    if (file.endsWith('.js'))
      return;
    self.loadSpiderInfo(path.join(SPIDERS_DIR, file, '/package.json'));
  });

  self.removeSpiders();

  self.ready_ = true;
  self.emit('ready');
}

Spiders.prototype.loadSpiderInfo = function(infopath) {
  var self = this;

  logger.info('Loading spider: ' + infopath);

  try {
    var spider = require(infopath);

    if (spider.match)
      spider.matchRegex = new RegExp(spider.match.unescapeURL());

    self.spiders_.push(spider);

  } catch (error) {
    logger.warn('Unable to load spider: ' + infopath + ': ' + error);
  }
}

Spiders.prototype.removeSpiders = function() {
  var self = this;
  
  // Remove spiders that
  // - Do not apply to this platform

  config.EXCLUDE_SPIDERS.forEach(function(spiderid) {
    self.spiders_.remove(function(spider) {
      return spider.name === spiderid;
  });
  });

  if (config.INCLUDE_SPIDERS.length > 0) {
    self.spiders_.remove(function(spider) {
      return config.INCLUDE_SPIDERS.findIndex(spider.name) === -1;
    });
  }
}

//
// Public
//
Spiders.prototype.isReady = function() {
  return this.ready_;
}

Spiders.prototype.getSpider = function(spiderName) {
  var self = this;
  var ret = null;

  self.spiders_.forEach(function(spider) {
    if (spider.name == spiderName) {
      ret = spider;
    }
  });

  return ret; 
}

Spiders.prototype.getSpiders = function() {
  return this.spiders_;
}

Spiders.prototype.loadSpider = function(spidername) {
  var modPath = './scrapers/' + spidername;
  var Spider = require(modPath);
  return new Spider();
}