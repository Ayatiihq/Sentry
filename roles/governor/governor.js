/*
 * governor.js: the governor
 *
 * (C) 2012 Ayatii Limited
 *
 * Governor is the main role. It is a singleton and is responsibile for setting
 * the heartbeat for the rest of the system.
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('governor.js')
  , util = require('util')
  ;

var Role = require('../role').Role;

var Governor = exports.Role = function() {
  this.init();
}

util.inherits(Governor, Role);

Governor.prototype.init = function() {
  var self = this;
  logger.info('Governor up and running');
}

//
// Overrides

Governor.prototype.getName = function() {
  return "governor";
}

Governor.prototype.getDisplayName = function() {
  return "Governor";
}

Governor.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Governor.prototype.end = function() {
  var self = this;
  self.emit('ended');
}