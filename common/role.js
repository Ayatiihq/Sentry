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

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('role.js')
  , util = require('util')
  ;

var Role = module.exports = function() {
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

/*
 * Default jobs order from a role
 */
Role.prototype.orderJobs = function(campaign, client) {
  var self = this
  ;
  
  var template = {owner : campaign._id,
                  consumer : self.getName(),
                  metadata : {}};

  return [template];
}

Role.prototype.start = function() {
  var self = this;
  logger.error(self.getName() + " has no start method");
  process.exit();
}

Role.prototype.end = function() {
  var self = this;
  logger.error(self.getName() + " has no end method");
  process.exit();
}
