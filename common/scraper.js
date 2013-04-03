/*
 * scraper.js: the base class for scrapers
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('scraper.js')
  , util = require('util')
  ;

var Scraper = module.exports = function() {
  this.init();

  //
  // Signals
  //

  // ("started") - When the scraper starts working, this must be sent once any
  //               state checking etc is done by the scraper and work starts

  // ("finished") - When the scraper has no more tasks to complete

  // ("error", err) - When there is an error to stops the scraper from continuing it's
  //                  work. Args: the error object

  // ("infringement", uri, metadata) - When an infringement is found.

  // ("metaInfringement", uri, metadata) = When an meta infringement is found.

  // ("relation", sourceUri, targetUri) - When a relation between uris is found.

  // ("metaRelation", uri) - When a meta relation should be made.

  // ("infringementStateChange", infringement, newState) - When the state of a infringement should be changed.
}

util.inherits(Scraper, events.EventEmitter);

Scraper.prototype.init = function() {
}

Scraper.prototype.getName = function() {
  return "scraper";
}

Scraper.prototype.start = function(campaign, job) {
  var self = this;
  logger.warn(self.getName() + " has no start method");
}

Scraper.prototype.stop = function() {
  var self = this;
  logger.warn(self.getName() + " has no stop method");
}

// If the processing of the job takes too long then isAlive expects the callback
// to be called with 'null' if everything is fine, otherwise 'err' if there is
// an issue.
Scraper.prototype.isAlive = function(callback) {
  callback(new Error('This method should be implemented'));
}