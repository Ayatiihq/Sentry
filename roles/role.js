/*
 * role.js: the base class for roles
 *
 * (C) 2012 Ayatii Limited
 *
 * A role represents all the different types of functions Sentry can carry out.
 * The Role base-class is what all roles should inherit from so the rest of the
 * system can function without being tied to specifics of roles.
 *
 */

var events = require('events')
  , logger = require('../logger').forFile('role.js')
  , util = require('util')
  ;

var Role = exports.Role = function() {
  this.init();

  //
  // Signals
  //

  // "started" - When the role starts working
  
  // "ended" - When the role ends working
  
  // "finished" - When the role has no more tasks to complete

  // "error" - When there is an error to stops the role from continuing it's
  //           work
}

util.inherits(Role, events.EventEmitter);

Role.prototype.init = function() {
}

Role.prototype.getName = function() {
  return "role";
}

Role.prototype.getDisplayName = function() {
  return "Role";
}

Role.prototype.start = function() {
  var self = this;
  logger.warn(self.getName() + " has no start method");
}

Role.prototype.end = function() {
  var self = this;
  logger.warn(self.getName() + " has no end method");
}
