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
  , campaigns = acquire('campaigns')
  , events = require('events')
  , logger = acquire('logger').forFile('role.js')
  , sugar = require('sugar')
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
Role.prototype.orderJobs = function(campaign, client, engines) {
  var self = this
    , template = {owner : campaign._id,
                  consumer : self.getName(),
                  metadata : {}}
  ;
  
  if(!engines || engines.isEmpty())
    return [template];

  var orders = [];
  
  logger.info('create multiple jobs for an engine based role ' + JSON.stringify(engines));

  engines.each(function(engine){
    var order = Object.clone(template, true);
    order.consumer = self.getName() + '.' + engine;
    orders.push(order);
  })
  return orders;
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

Role.prototype.heartbeat = function (campaigns, campaign) {
  var self = this;
  if (campaign === undefined) { logger.error('Heartbeat triggered with no campaign: ', self.getName()); return; }

  // inc to db
  var today = Date.create('today');
  campaigns.update({ _id: campaign._id, 'heartBeats': today},
                   { $inc: { "heartBeats.$": 1 }},
                   function (err) { if (err) { logger.warn('Error submitting heartbeat: ', self.getName(), err); } });
}

Role.prototype.startBeat = function (campaigns, campaign) {
  var self = this;
  if (self.heartBeatTimer) { logger.warn('Heartbeat start when already beating heart: ', self.getName()); return; }
  self.heartBeatTimer = self.heatbeat.every(60000, campaigns, campaign);
}

Role.prototype.endBeat = function () {
  var self = this;
  if (!self.heartBeatTimer) { logger.warn('Heartbeat end called when no beating heart present: ', self.getName()); return; }
  self.heartBeatTimer.cancel();
}