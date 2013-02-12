/*
 * governor.js: the governor
 *
 * (C) 2012 Ayatii Limited
 *
 * Governor is the main role. It is a singleton and is responsibile for setting
 * the heartbeat for the rest of the system.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('governor.js')
  , util = require('util')
  ;

var Role = acquire('role')
  , ScraperDispatcher = require('./scraper-dispatcher')
  , SpiderDispatcher = require('./spider-dispatcher')
  ;

var Governor = module.exports = function() {
  this.scraperDispatcher_ = null;
  this.spiderDispatcher_ = null;
  this.init();
}

util.inherits(Governor, Role);

Governor.prototype.init = function() {
  var self = this;

  self.initJobs();
  logger.info('Running');
}

Governor.prototype.initJobs = function() {
  var self = this;

  self.scraperDispatcher_ = new ScraperDispatcher();
  self.spiderDispatcher_ = new SpiderDispatcher();
}

//
// Overrides
//
Governor.prototype.getName = function() {
  return "governor";
}

Governor.prototype.getDisplayName = function() {
  return "Governor";
}

Governor.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Governor.prototype.end = function() {
  var self = this;
  self.emit('ended');
}