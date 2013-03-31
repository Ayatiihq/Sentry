/*
 * miner-dispatcher.js: the miner-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches Miner jobs
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('miner-dispatcher.js')
  , states = acquire('states').jobs.state
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Seq = require('seq')
  ;

var MinerDispatcher = module.exports = function() {
  this.campaigns_ = null;
  this.jobs_ = null;

  this.init();
}

util.inherits(MinerDispatcher, events.EventEmitter);

MinerDispatcher.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.jobs_ = new Jobs('miner');

  setTimeout(self.iterateCampaigns.bind(self), config.MINER_CHECK_INTERVAL_MINUTES * 60 * 1000);
  self.iterateCampaigns();
}

MinerDispatcher.prototype.iterateCampaigns = function() {
  var self = this;

  self.campaigns_.listActiveCampaigns(function(err, campaigns) {
    if (err)
      logger.warn(err);
    else
      campaigns.forEach(self.checkCampaign.bind(self));
  });
}

MinerDispatcher.prototype.checkCampaign = function(campaign) {
  var self = this;

  self.jobs_.listActiveJobs(campaign._id, function(err, jobs) {
    if (err) {
      return logger.warn('Unable to get active obs for campaign %s, %s', campaign, err);
    }

    if (self.doesCampaignNeedJob(campaign, jobs)) {
      self.createJob(campaign);
    } else {
      logger.info('Existing job for %j', campaign._id);
    }
  });
}

MinerDispatcher.prototype.doesCampaignNeedJob = function(campaign, lastJobs) {
  var self = this;

  job = lastJobs.last();

  if (!job)
    return true;

  switch(job.state) {
    case states.QUEUED:
    case states.PAUSED:
      return false;

    case states.STARTED:
      var tooLong = Date.create(job.popped).isBefore(config.MINER_JOB_TIMEOUT_SECONDS + ' seconds ago');
      return tooLong;

    default:
      return true;
  }
}

MinerDispatcher.prototype.createJob = function(campaign) {
  var self = this;

  self.jobs_.push(campaign._id, '', {}, function(err, id) {
    if (err)
      logger.warn('Unable to create job for %j: %s', campaign._id, err);
    else
      logger.info('Created job for %j: %s', campaign._id, id);
  });
}