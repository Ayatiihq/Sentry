/*
 * governor.js: the governor
 *
 * (C) 2012 Ayatii Limited
 *
 * Governor represents the cluster to the rest of the hive, starts the appropriete
 * number of workers, and uses the schedular to assign the correct roles to them.
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

Role.prototype.getName = function() {
  return "governor";
}

Role.prototype.getDisplayName = function() {
  return "Governor";
}

Role.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Role.prototype.end = function() {
  var self = this;
  self.emit('ended');
}