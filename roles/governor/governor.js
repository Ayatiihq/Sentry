/*
 * governor.js: the governor
 *
 * (C) 2012 Ayatii Limited
 *
 * Governor is the main role. It is a singleton and is responsibile for setting
 * the heartbeat for the rest of the system.
 *
 */

var config = require('../../config')
  , events = require('events')
  , logger = require('../../logger').forFile('governor.js')
  , pg = require('pg').native
  , util = require('util')
  ;

var ScraperDispatcher = require('./scraper-dispatcher');

var Role = require('../role').Role;

var Governor = exports.Role = function() {
  this.postgres_ = null;

  this.init();
}

util.inherits(Governor, Role);

Governor.prototype.init = function() {
  var self = this;

  pg.connect(config.DATABASE_URL, this.onDatabaseConnection.bind(this));

  logger.info('Running');
}

Governor.prototype.onDatabaseConnection = function(error, client) {
  var self = this;

  if (error) {
    console.log('Unable to connect to the database, exitting', error);
    self.emit('error', error);
    return;
  }

  self.postgres_ = client;

  self.initJobs();
}

Governor.prototype.initJobs = function() {
  var self = this;

  self.scraperDispatcher_ = new ScraperDispatcher(self.postgres_);
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