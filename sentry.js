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
  , util = require('util')
  , os = require('os')
  ;

var Sentry = exports.Sentry = function() {
  var id_ = '';

  this.init();
}

util.inherits(Sentry, events.EventEmitter);

Sentry.prototype.init = function() {
  var self = this;

  self.id_ = os.hostname() + '::' + process.pid;

  logger.info('Sentry up and running. ID: ' + self.id_);
/*
  logger.info('\tHostname: ' + os.hostname());
  logger.info('\tPlatform: ' + os.platform());
  logger.info('\tArch: ' + os.arch());
  logger.info('\tRelease: ' + os.release());
  logger.info('\tUptime: ' + os.uptime());
  logger.info('\tPID: ' + process.pid);
  logger.info('\tTitle: ' + process.title);
  logger.info('\tMemory: ' + util.inspect(process.memoryUsage()));
  logger.info('');*/
}

Sentry.prototype.getId = function() {
  return this.id_;
}
