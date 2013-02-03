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
  , db = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('governor.js')
  , pg = require('pg').native
  , util = require('util')
  ;

var Role = acquire('role')
  , ScraperDispatcher = require('./scraper-dispatcher');

var Governor = module.exports = function() {
  this.init();
}

util.inherits(Governor, Role);

Governor.prototype.init = function() {
  var self = this;

  if (db.isReady())
    self.onDatabaseReady();
  else
    db.on('ready', self.onDatabaseReady.bind(self));

  logger.info('Running');
}

Governor.prototype.onDatabaseReady = function() {
  var self = this;

  self.initJobs();
}

Governor.prototype.initJobs = function() {
  var self = this;

  self.scraperDispatcher_ = new ScraperDispatcher();
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