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

var ROLE = "";

var Logger = function(filename) {
  var id = os.hostname()  + '::' + process.pid;

  if (!cluster.isMaster) {
    id += '::' + cluster.worker.id;
  }

  this.prefix_ = id + ':' + filename + ':';
}

Logger.prototype.info = function() {
  var string = format.apply(null, arguments);
  winston.info(this.prefix_ + ':' + ROLE + string);
}

Logger.prototype.debug = function() {
  var string = format.apply(null, arguments);
  winston.debug(this.prefix_ + ROLE + lineNumber() + ': ' + string);
}

Logger.prototype.warn = function() {
  var string = format.apply(null, arguments);
  winston.warn(this.prefix_ + ROLE + lineNumber() + ': ' + string);
}

Logger.prototype.error = function() {
  var args = Array.prototype.slice.call(arguments, 0);
  var string = format.apply(null, arguments);
  var errorString = this.prefix_ + ROLE + lineNumber() + ': ' +  string;

  var error = args.find(function (v) { return v instanceof Error; });
  if (!!error) {
  	// an error was passed into the arguments list, so lets sugar the 
  	// displayed message with a little more than an error message.
  	errorString += "\n"
  	errorString += error.stack;
  }

  winston.error(errorString);
}

Logger.prototype.trace = function () {
  if (process.env['SENTRY_DEBUG_TRACE'] === undefined) { return; }
  var string = format.apply(null, arguments);
  winston.info(this.prefix_ + ROLE + lineNumber() + ':' + functionName() + ': ' + string);
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
  winston.add(winston.transports.Papertrail, { host: 'logs.papertrailapp.com', port: 14963 });
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
