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

require('sugar');
var Papertrail = require('winston-papertrail').Papertrail;

var levels = {
      trace: 1,
      debug: 2,
      info: 3,
      warn: 4,
      error: 5
    }
  , colors = {
      trace: 'white',
      debug: 'blue',
      info: 'green',
      warn: 'yellow',
      error: 'red'
    }
  ;

winston.addColors(colors);
var logger = new (winston.Logger)({ levels: levels })
  , inited = false
  ;

var SENTRY_DEBUG = process.env.SENTRY_DEBUG || 'debug'
  , SENTRY_DEBUG_LEVEL = levels[SENTRY_DEBUG]
  ;

var Logger = function(filename) {
  var id = os.hostname()  + '::' + process.pid;

  if (!cluster.isMaster) {
    id += '::' + cluster.worker.id;
  }

  this.prefix_ = id + ':' + filename + ':';
  this.logger_ = logger;
}

Logger.prototype.trace = function () {
  if (SENTRY_DEBUG_LEVEL > levels['trace']) return;
  if (!inited) exports.init();
  var string = format.apply(null, arguments);
  this.logger_.trace(this.prefix_ + lineNumber() + ':' + ': ' + string);
}

Logger.prototype.debug = function () {
  if (SENTRY_DEBUG_LEVEL > levels['debug']) return;
  if (!inited) exports.init();
  var string = format.apply(null, arguments);
  this.logger_.debug(this.prefix_ + lineNumber() + ':' + ': ' + string);
}

Logger.prototype.info = function() {
  if (SENTRY_DEBUG_LEVEL > levels['info']) return;
  if (!inited) exports.init();
  var string = format.apply(null, arguments);
  this.logger_.info(this.prefix_ + ':' + string);
}

Logger.prototype.warn = function() {
  if (!inited) exports.init();
  var string = format.apply(null, arguments);
  this.logger_.warn(this.prefix_ + lineNumber() + ': ' + string);
}

Logger.prototype.error = function() {
  if (!inited) exports.init();
  var args = Array.prototype.slice.call(arguments, 0);
  var string = format.apply(null, arguments);
  var errorString = this.prefix_ + lineNumber() + ': ' +  string;

  var error = args.find(function (v) { return v instanceof Error; });
  if (!!error) {
  	// an error was passed into the arguments list, so lets sugar the 
  	// displayed message with a little more than an error message.
  	errorString += "\n"
  	errorString += error.stack;
  }

  console.log(this);

  this.logger_.error(errorString);
}

exports.forFile = function(filename) {
  return new Logger(filename);
}

exports.init = function() {
  if (inited) return;
  inited = true;
  logger.add(winston.transports.Console, { level: SENTRY_DEBUG, colorize: true, timestamp: true });
}

exports.initServer = function() {
  if (inited) return;
  inited = true;
  logger.add(winston.transports.Console, { level: SENTRY_DEBUG, colorize: true, timestamp: true });
  logger.add(winston.transports.Papertrail, { level: 'info',  host: 'logs.papertrailapp.com', port: 14963 });
}

function lineNumber() {
  return (new Error).stack.split("\n")[3].match(/:([0-9]+):/)[1];
}

function functionName() {
  return (new Error).stack.split('\n')[3].match(/at (\w+(\.<?[\w\b]+>?)*)/)[1];
}

// calls dictFormat and util.format intelligently depending on the input
function format() {
  var args = Array.prototype.slice.call(arguments, 0);
  if (args.length === 2) {
  	if (!checkDictFormat.apply(null, args)) {
      // good match
      return dictFormat.apply(null, args);
  	}
  }

  return util.format.apply(null, arguments);

}

// basically a templating system, pass in a string with ${key} and i'll replace with the value from the dictionary for that key
// for example:
// dictFormat("testing ${owner} ${name} ${garbled}ifiction", {owner: 'gord', name:'Format', garbled:'californ'});
//   => testing gord Format californifiction
exports.dictFormat = dictFormat = function (string, formatDictionary) {
  var re = new RegExp("\\$\\{(\\w+)\\}", 'g');
  return string.replace(re, function(subString, subGroup) { return Object.has(formatDictionary, subGroup) ? formatDictionary[subGroup] : subString });
}

// relates to the above function, tells us if we have a good match of string to dictionary
function checkDictFormat(string, formatDictionary) {
  var re = new RegExp("\\$\\{(\\w+)\\}", 'g');
  if (!re.test(string)) { return new Error('no matches'); }
  try {
  	// we just use .replace because its an easy way of itterating over regular expression results
  	string.replace(re, function(subString, subGroup) { if (!Object.has(formatDictionary, subGroup)) { throw new Error(subGroup); } });
  }
  catch (err) {
  	return err;
  }

  return;
}
