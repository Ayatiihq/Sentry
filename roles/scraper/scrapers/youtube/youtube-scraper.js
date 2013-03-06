/*
 * youtube.js: a youtube scraper
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
  , logger = acquire('logger').forFile('youtube.js')
  , util = require('util')
;

var Scraper = acquire('scraper');

var Youtube = module.exports = function () {
  this.init();
}

util.inherits(Youtube, Scraper);

Youtube.prototype.init = function () {
  var self = this;
}

//
// Overrides
//
Youtube.prototype.getName = function () {
  return "youtube";
}

Youtube.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign.name);
  self.emit('started');
}

Youtube.prototype.stop = function () {
  var self = this;
  self.emit('finished');
}

Youtube.prototype.isAlive = function (cb) {
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