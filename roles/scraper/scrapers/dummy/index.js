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

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('dummy.js')
  , util = require('util')
  ;

var Scraper = acquire('scraper');

var Dummy = module.exports = function() {
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

Dummy.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

Dummy.prototype.stop = function() {
  var self = this;
  self.emit('finished');
}

Dummy.prototype.isAlive = function(cb) {
  var self = this;

  logger.info('Is alive called');

  if (!self.alive)
    self.alive = 1;
  else
    self.alive++;

  if (self.alive > 4)
    cb(new Error('exceeded'));
  else
    cb();
}