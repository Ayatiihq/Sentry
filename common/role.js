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

Role.prototype.startBeat = function (campaigns, campaign) {
  var self = this;
  if (self.heartBeatTimer) { 
    logger.warn('Heartbeat start when already beating heart: ', self.getName()); 
    try { self.heartBeatTimer.cancel(); } catch (err) { }
    self.heartBeatTimer = null;
  }
  
  function beatHeart (campaigns_, campaign_) {
   if (campaign_ === undefined) { logger.error('Heartbeat triggered with no campaign: ', self.getName()); return; }

    // inc to db
    var todayKey = 'heartBeats.' + today.toString();
    var heartRateDiff = process.hrtime(self.lastHeartBeat)[0];
    heartRateDiff = heartRateDiff > 0 ? heartRateDiff : 1; // at least one second else things will slip through
    self.lastHeartBeat = process.hrtime();

    campaigns_.updateDetailed(campaign_._id,
                              { $inc: { key: heartRateDiff }},
                              function (err) { if (err) { logger.warn('Error submitting heartbeat: ', self.getName(), err); } });

  }

  self.lastHeartBeat = process.hrtime();
  self.heartBeatTimer = beatHeart.every(60000, campaigns, campaign);
  beatHeart();
}

Role.prototype.stopBeat = function () {
  var self = this;
  if (!self.heartBeatTimer) { logger.warn('Heartbeat end called when no beating heart present: ', self.getName()); return; }
  self.heartBeatTimer.cancel();
  self.heartBeatTimer = null;
}