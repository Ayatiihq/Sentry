/*
 * logger.js: custom logger built on top of winston
 *
 * (C) 2012 Ayatii Limited
 *
 * Uses winston for logging, but adds a couple of things that make the logs a bit
 * more useful. 
 *
 */

var winston = require('winston');

var logger = exports;

var Logger = function(filename) {
  this.filename_ = filename + ': ';
}

Logger.prototype.info = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.info(this.filename_ + string, object );
}

Logger.prototype.debug = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.debug(this.filename_ + string, object );
}

Logger.prototype.warn = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.warn(this.filename_ + string, object );
}

Logger.prototype.error = function(string, object) {
  object = typeof object !== 'undefined' ? object : {};
  winston.error(this.filename_ + string, object );
}

logger.forFile = function(filename) {
  return new Logger(filename);
}