/*
 * scraper.js: the scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper is the general link scraping role.
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('scraper.js')
  , util = require('util')
  ;

var Role = require('../role').Role;

var Scraper = exports.Role = function() {
  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;
  logger.info('Scraper up and running');
}

//
// Overrides

Scraper.prototype.getName = function() {
  return "scraper";
}

Scraper.prototype.getDisplayName = function() {
  return "Scraper";
}

Scraper.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}