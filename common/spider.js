/*
 * spider.js: the base class for spiders
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('spider.js')
  , util = require('util')
  ;

var Spider = module.exports = function() {
  this.init();

  //
  // Signals
  //

  // ("started") - When the spider starts working, this must be sent once any
  //               state checking etc is done by the spider and work starts

  // ("finished") - When the spider has no more tasks to complete

  // ("error", err) - When there is an error to stops the spider from continuing it's
  //                  work. Args: the error object

  // ("link", linkObject) - When a link is found, should meet the schema for the specific
  //                        type of link.
}

util.inherits(Spider, events.EventEmitter);

Spider.prototype.init = function() {
}

Spider.prototype.getName = function() {
  return "spider";
}

Spider.prototype.start = function(job) {
  var self = this;
  logger.warn(self.getName() + " has no start method");
}

Spider.prototype.stop = function() {
  var self = this;
  logger.warn(self.getName() + " has no stop method");
}

// If the processing of the job takes too long then isAlive expects the callback
// to be called with 'null' if everything is fine, otherwise 'err' if there is
// an issue.
Spider.prototype.isAlive = function(callback) {
  callback(new Error('this method should be implemented.'));
}