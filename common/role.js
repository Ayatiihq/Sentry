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
  // "decided" - When the role has decided how many jobs it would like, emits quantity.
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
 * Default decision on how much work a role wants from a given 
 * campaign and client
 */
Role.prototype.jobsDecision = function(campaign, client, jobs) {
  var self = this
    , quantity = 0
  ;

  if (self.types) {
    var supported = false;
    Object.keys(self.types, function(type) {
      if (campaign.type.startsWith(type))
        supported = true;
    });

    if (!supported) {
      logger.info('%s does not support %s (%s)', self.name, campaign.name, campaign.type);
      return quantity;
    }
  }
  
  // Special case for the notice sender.
  if(self.name === 'noticesender' && (!client.authorization || !client.copyrightContact)){
    logger.info('Not going to create a noticesending job for ' + campaign.name + ', we dont have the goods.');
    return quantity;
  }
  if (self.engines && self.engines.length) {
      self.engines.forEach(function(engine) {
        if(self.validateWork(campaign, jobs, getRoleConsumerId(self.name, engine)))
          quantity += 1;
      });
    } else {
      if(self.validateWork(campaign, jobs)
        quantity = 1;
    }  
    return quantity;
    
}


Role.prototype.validateWork = function(campaign, jobs, consumer) {
  var self = this
    ;
  
  if(!consumer)
    consumer = self.name;

  jobs.listActiveJobs(campaign._id, function(err, array, existingJobs) {
    if (err) {
      return logger.warn('Unable to get active jobs for campaign %s, %s', consumer, err);
    }

    if (self.doesCampaignNeedJob(campaign, jobs, existingJobs[consumer])) {
      self.createJob(campaign, jobs, consumer);
    } else {
      logger.info('Existing job for %s', consumer);
    }
  });
}

Role.prototype.doesCampaignNeedJob = function(campaign, jobs, lastJob) {
  var self = this;

  if (!lastJob)
    return true;

  switch(lastJob.state) {
    case states.QUEUED:
    case states.PAUSED:
      return false;

    case states.STARTED:
      if (self.longRunning)
        return false;

      var tooLong = Date.create(lastJob.popped).isBefore((config.STANDARD_JOB_TIMEOUT_MINUTES + 2 ) + ' minutes ago');
      if (tooLong)
        jobs.close(lastJob, states.ERRORED, new Error('Timed out'));
      return tooLong;

    case states.COMPLETED:
      var waitBeforeNextRun = self.intervalMinutes ? self.intervalMinutes : campaign.sweepIntervalMinutes;
      var waitedLongEnough = Date.create(lastJob.finished).isBefore(waitBeforeNextRun + ' minutes ago');
      return waitedLongEnough;

    default:
      return true;
  }
}

function getRoleConsumerId(role, consumer) {
  if (role === consumer)
    return role;
  else
    return role + '.' + consumer;
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
