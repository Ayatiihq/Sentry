/*
 * sentry.js: the sentry
 *
 * (C) 2012 Ayatii Limited
 *
 * Sentry is responsible for fulfilling any of the #Roles that are required by
 * the system. A Sentry is created once per process and will choose appropriate
 * roles depending on what the #Scheduler is signaling to it. It can change
 * roles on-the-fly, but normally waits to be signalled by the currently 
 * running role for a good time to do so. 
 *
 */

var events = require('events')
  , logger = require('winston')
  , sugar = require('sugar')
  , util = require('util')
  ;

var Sentry = exports.Sentry = function() {
  this.init();
}

util.inherits(Sentry, events.EventEmitter);

Sentry.prototype.init = function() {
  var self = this;

  logger.info('Sentry up and running.');
}