/*
 * downloader.js: the downloader
 *
 * (C) 2012 Ayatii Limited
 *
 * Downloader is the general link downloading role.
 *
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('downloader.js')
  , util = require('util')
  ;

var Role = acquire('role');

var Downloader = module.exports = function() {
  this.init();
}

util.inherits(Downloader, Role);

Downloader.prototype.init = function() {
  var self = this;
  logger.info('Downloader up and running');
}

//
// Overrides

Downloader.prototype.getName = function() {
  return "downloader";
}

Downloader.prototype.getDisplayName = function() {
  return "Downloader";
}

Downloader.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Downloader.prototype.end = function() {
  var self = this;
  self.emit('ended');
}