/*
 * index.js: the scraper role
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper is the general link scraping role.
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('index.js')
  , util = require('util')
  ;

var Role = require('../role');

var Scraper = module.exports = function() {
  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;
  logger.info('Scraper up and running');
}

//
// Overrides
//
Scraper.prototype.getName = function() {
  return "scraperRole";
}

Scraper.prototype.getDisplayName = function() {
  return "Scraper Role";
}

Scraper.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}