/*
 * standard-dispatcher.js: the standard-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches jobs for standard roles per-campaign
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('standard-dispatcher.js')
  , states = acquire('states').jobs.state
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Clients = acquire('clients')
  , Jobs = acquire('jobs')
  , Roles = acquire('roles')
  ;

var StandardDispatcher = module.exports = function() {
  this.campaigns_ = null;
  this.roles_ = null;
  this.clients_ = null;

  this.init();
}

util.inherits(StandardDispatcher, events.EventEmitter);

StandardDispatcher.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.clients_ = new Clients();
  self.roles_ = new Roles();

  setInterval(self.iterateCampaigns.bind(self), config.STANDARD_CHECK_INTERVAL_MINUTES * 60 * 1000);
  
  self.roles_.on('ready', self.iterateCampaigns.bind(self));
}

StandardDispatcher.prototype.iterateCampaigns = function() {
  var self = this;

  self.campaigns_.listActiveCampaigns(function(err, campaigns) {
    if (err)
      logger.warn(err);
    else
      campaigns.forEach(self.preCheckRoles.bind(self));
  });
}

StandardDispatcher.prototype.preCheckRoles = function(campaign) {
  var self = this;
  
  self.clients_.get(campaign.client, function(err, client){
    if(err)
      return logger.warn('Error retrieving Client from campaign ' + campaign.name);
    self.checkRoles(campaign, client);
  })
}

StandardDispatcher.prototype.checkRoles = function(campaign, client) {
  var self = this;

  self.roles_.getRoles().forEach(function(role) { 
    if (role.dispatcher)
      return;

    if (role.types) {
      var supported = false;
      Object.keys(role.types, function(type) {
        if (campaign.type.startsWith(type))
          supported = true;
      });

      if (!supported) {
        logger.info('%s does not support %s (%s)', role.name, campaign.name, campaign.type);
        return;
      }
    }
    
    // Special case for the notice sender.
    if(role.name === 'noticesender' && (!client.authorization || !client.copyrightContact)){
      logger.info('Not going to create a noticesending job for ' + campaign.name + ', we dont have the goods.');
      return;
    }

    if (role.engines && role.engines.length) {
      role.engines.forEach(function(engine) {
        self.checkRole(campaign, role, getRoleConsumerId(role.name, engine));
      });
    } else {
      self.checkRole(campaign, role, role.name);
    }
  });
}

StandardDispatcher.prototype.checkRole = function(campaign, role, consumer) {
  var self = this
    , jobs = new Jobs(role.name)
    ;  
  self.checkCampaign(campaign, jobs, role, consumer);
}

StandardDispatcher.prototype.checkCampaign = function(campaign, jobs, role, consumer) {
  var self = this
    ;

  jobs.listActiveJobs(campaign._id, function(err, array, existingJobs) {
    if (err) {
      return logger.warn('Unable to get active jobs for campaign %s, %s', consumer, err);
    }

    if (self.doesCampaignNeedJob(campaign, role, jobs, existingJobs[consumer])) {
      self.createJob(campaign, jobs, role, consumer);
    } else {
      logger.info('Existing job for %s', consumer);
    }
  });
}

StandardDispatcher.prototype.doesCampaignNeedJob = function(campaign, role, jobs, lastJob) {
  var self = this;

  if (!lastJob)
    return true;

  switch(lastJob.state) {
    case states.QUEUED:
    case states.PAUSED:
      return false;

    case states.STARTED:
      if (role.longRunning)
        return false;

      var tooLong = Date.create(lastJob.popped).isBefore((config.STANDARD_JOB_TIMEOUT_MINUTES + 2 ) + ' minutes ago');
      if (tooLong)
        jobs.close(lastJob, states.ERRORED, new Error('Timed out'));
      return tooLong;

    case states.COMPLETED:
      var waitBeforeNextRun = role.intervalMinutes ? role.intervalMinutes : campaign.sweepIntervalMinutes;
      var waitedLongEnough = Date.create(lastJob.finished).isBefore(waitBeforeNextRun + ' minutes ago');
      return waitedLongEnough;

    default:
      return true;
  }
}

StandardDispatcher.prototype.createJob = function(campaign, jobs, role, consumer) {
  var self = this;

  jobs.push(campaign._id, consumer, {}, function(err, id) {
    if (err)
      logger.warn('Unable to create job for %j: %s: %s', campaign._id, consumer, err);
    else
      logger.info('Created job for %j: %s', campaign._id, id);
  });
}

function getRoleConsumerId(role, consumer) {
  if (role === consumer)
    return role;
  else
    return role + '.' + consumer;
}