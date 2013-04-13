/*
 * logger.js: custom logger built on top of winston
 *
 * (C) 2012 Ayatii Limited
 *
 * Uses winston for logging, but adds a couple of things that make the logs a bit
 * more useful. 
 *
 */

// var __LINE__ = (new Error).stack.split("\n")[1].match(/:([0-9]+):/)[1];

var cluster = require('cluster')
  , os = require('os')
  , util = require('util')
  , winston = require('winston');

var Logger = function(filename) {
  var id = os.hostname()  + '::' + process.pid;

  if (!cluster.isMaster) {
    id += '::' + cluster.worker.id;
  }

  this.prefix_ = id + ':' + filename + ': ';
}

Logger.prototype.info = function() {
  var string = util.format.apply(null, arguments);
  winston.info(this.prefix_ +  string);
}

Logger.prototype.debug = function() {
  var string = util.format.apply(null, arguments);
  winston.debug(this.prefix_ +  string);
}

Logger.prototype.warn = function() {
  var string = util.format.apply(null, arguments);
  winston.warn(this.prefix_ +  string);
}

Logger.prototype.error = function() {
  var string = util.format.apply(null, arguments);
  winston.error(this.prefix_ +  string);
}

exports.forFile = function(filename) {
  return new Logger(filename);
}

exports.init = function() {
  winston.remove(winston.transports.Console);
  winston.add(winston.transports.Console, { colorize: true, timestamp: true });
}