/*
 * scraper.js: the base class for scrapes
 *
 * (C) 2012 Ayatii Limited
 *
 */

var events = require('events')
  , logger = require('../logger').forFile('scraper.js')
  , util = require('util')
  ;

var Scraper = module.exports = function() {
  this.init();

  //
  // Signals
  //

  // "started" - When the scraper starts working
  
  // "ended" - When the scraper stops working
  
  // "finished" - When the scraper has no more tasks to complete

  // "error" - When there is an error to stops the scraper from continuing it's
  //           work
}

util.inherits(Scraper, events.EventEmitter);

Scraper.prototype.init = function() {
}

Scraper.prototype.getName = function() {
  return "scraper";
}

Scraper.prototype.start = function() {
  var self = this;
  logger.warn(self.getName() + " has no start method");
}

Scraper.prototype.end = function() {
  var self = this;
  logger.warn(self.getName() + " has no end method");
}
