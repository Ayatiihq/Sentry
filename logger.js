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
  , os = require('os')
  , winston = require('winston');

var Logger = function(filename) {
  var id = os.hostname();

  if (!cluster.isMaster) {
    id += ':' + cluster.worker.id;
  }

  this.prefix_ = id + ':' + filename + ': ';
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

exports.forFile = function(filename) {
  return new Logger(filename);
}

exports.init = function() {
  winston.remove(winston.transports.Console);
  winston.add(winston.transports.Console, { colorize: true, timestamp: true });
}