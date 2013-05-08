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
  , winston = require('winston')
  ;

require('winston-loggly');

var Papertrail = require('winston-papertrail').Papertrail;

var ROLE = "";

var Logger = function(filename) {
  var id = os.hostname()  + '::' + process.pid;

  if (!cluster.isMaster) {
    id += '::' + cluster.worker.id;
  }

  this.prefix_ = id + ':' + filename + ':';
}

Logger.prototype.info = function() {
  var string = util.format.apply(null, arguments);
  winston.info(this.prefix_ + ':' + ROLE + string);
}

Logger.prototype.debug = function() {
  var string = util.format.apply(null, arguments);
  winston.debug(this.prefix_ + ROLE + lineNumber() + ': ' + string);
}

Logger.prototype.warn = function() {
  var string = util.format.apply(null, arguments);
  winston.warn(this.prefix_ + ROLE + lineNumber() + ': ' + string);
}

Logger.prototype.error = function() {
  var string = util.format.apply(null, arguments);
  winston.error(this.prefix_ + ROLE + lineNumber() + ': ' +  string);
}

Logger.prototype.setRole = function(role) {
  //ROLE = role + ':';
}

exports.forFile = function(filename) {
  return new Logger(filename);
}

exports.init = function() {
  winston.remove(winston.transports.Console);
  winston.add(winston.transports.Console, { colorize: true, timestamp: true });
}

exports.initServer = function() {
  winston.remove(winston.transports.Console);
  winston.add(winston.transports.Console, { colorize: true, timestamp: true });
  winston.add(winston.transports.Loggly, { level: 0, subdomain: 'scout', inputToken:'40b87e62-5974-4d54-a249-bb843d3d48bb', json:true });
  winston.add(winston.transports.Papertrail, { host: 'logs.papertrailapp.com', port: 14963 });
}

function lineNumber() {
  return (new Error).stack.split("\n")[3].match(/:([0-9]+):/)[1];
}