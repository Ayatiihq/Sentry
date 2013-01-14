/*
 * dummy.js: a dummy scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper that can scrape all types of media and always takes 5mins to complete
 * it's job. It can be paused and, if so, it will resume it's five minute
 * timeout.
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('dummy.js')
  , util = require('util')
  ;

var Role = require('../scraper').Scraper;

var Dummy = exports.Scraper = function() {
  this.init();
}

util.inherits(Dummy, Scraper);

Dummy.prototype.init = function() {
  var self = this;
  logger.info('Scraper up and running');
}

//
// Overrides
//
Dummy.prototype.getName = function() {
  return "dummy";
}

Dummy.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Dummy.prototype.end = function() {
  var self = this;
  self.emit('ended');
}