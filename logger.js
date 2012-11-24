/*
 * logger.js: custom logger built on top of winston
 *
 * (C) 2012 Ayatii Limited
 *
 * Uses winston for logging, but adds a couple of things that make the logs a bit
 * more useful. 
 *
 */

var cluster = require('cluster')
  , winston = require('winston');

var logger = exports;

var Logger = function(filename) {
  var id = "";

  if (cluster.isMaster) {
    id = "master";
  } else {
    id = cluster.worker.id;
  }

  this.prefix_ = id + '::' + filename + ': ';
}

Logger.prototype.info = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.info(this.prefix_ + string, object );
}

Logger.prototype.debug = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.debug(this.prefix_ + string, object );
}

Logger.prototype.warn = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.warn(this.prefix_ + string, object );
}

Logger.prototype.error = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.error(this.prefix_ + string, object );
}

logger.forFile = function(filename) {
  return new Logger(filename);
}

logger.init = function() {
  winston.remove(winston.transports.Console);
  winston.add(winston.transports.Console, { colorize: true, timestamp: true });
}