/*
 * scraper-dispatcher.js: the scraper-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches Scraper jobs for campaigns
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('scraper-dispatcher.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Seq = require('seq')
  , Scrapers = acquire('scrapers');

var ScraperDispatcher = module.exports = function() {
  this.campaigns_ = null;
  this.jobs_ = null;
  this.scrapers_ = null;

  this.init();
}

util.inherits(ScraperDispatcher, events.EventEmitter);

ScraperDispatcher.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.jobs_ = new Jobs('scraper');

  self.scrapers_ = new Scrapers();
  if (self.scrapers_.isReady()) {
    self.start();
  } else {
    self.scrapers_.on('ready', self.start.bind(self));
  }
}

ScraperDispatcher.prototype.start = function() {
  var self = this;

  // Do a basic check on campaigns on an interval
  setInterval(self.iterateCampaigns.bind(self), config.GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES * 60 * 1000);

  // Kick off the first one
  self.iterateCampaigns();
}

ScraperDispatcher.prototype.iterateCampaigns = function() {
  var self = this;

  self.campaigns_.listActiveCampaigns(function(err, campaigns) {
    if (err)
      logger.warn(err);
    else
      campaigns.forEach(self.checkCampaign.bind(self));
  });
}

ScraperDispatcher.prototype.checkCampaign = function(campaign) {
  var self = this;

  self.jobs_.listActiveJobs(campaign._id, function(err, jobs, mappedJobs) {
    if (err) {
      logger.warn('Unable to get active jobs for campaign: ' + campaign + ': ' + err);
      return;
    }
    self.enqueueJobsForCampaign(campaign, mappedJobs);
  });
}

ScraperDispatcher.prototype.enqueueJobsForCampaign = function(campaign, lastJobs) {
  var self = this;
  var types = campaign.type.split('.'); // we get tv.live
  var type = types[0];
  var scope = types[1];

  var scrapers = self.scrapers_.getScrapersForType(type, scope);
  if (scrapers === undefined) {
    logger.warn('No scrapers are able to handle type:' + type + ' and scope: ' + scope);
    return;
  }

  scrapers.forEach(function(scraper) {
    logJob(campaign, scraper, 'Checking job status');

    if (self.scraperIgnoredByCampaign(campaign, scraper)) {
      logJob(campaign, scraper, 'Scraper is ignored for this campaign');
      return;
    }

    if (self.scraperHasExistingValidJob(campaign, lastJobs, scraper)) {
      logJob(campaign, scraper, 'Existing job in progress');
      return;
    }

    self.createScraperJob(campaign, scraper);
  });
}

ScraperDispatcher.prototype.scraperIgnoredByCampaign = function(campaign, scraper) {
  var self = this;

  if (campaign.scrapersEnabled.length) {
    return !campaign.scrapersEnabled.any(scraper.name);
  }

  if (campaign.scrapersIgnored.length) {
    return campaign.scrapersIgnored.any(scraper.name);
  }

  return false;
}

ScraperDispatcher.prototype.scraperHasExistingValidJob = function(campaign, lastJobs, scraper) {
  var self = this;
  var state = states.jobs.state;

  var lastJob = lastJobs[scraper.name];
  if (!lastJob)
    return false;

  logJob(campaign, scraper, 'Inspecting existing job ' + lastJob.id + ' state: ' + lastJob.state);

  // It has a job logged, but is it valid?
  switch (lastJob.state) {
    case state.QUEUED:
      var jobValid = !self.scraperQueuedForTooLong(campaign, scraper, lastJob);
      if (!jobValid) {
        self.setJobAsExpired(lastJob, "Queued/Paused for too long");
      }
      return jobValid;

    case state.STARTED:
      var jobValid = !self.scraperStartedForTooLong(campaign, scraper, lastJob);
      if (!jobValid) {
        self.setJobAsExpired(lastJob, "Started for too long");
      }
      return jobValid;

    case state.PAUSED:
    case state.CANCELLED:
    case state.ERRORED:
      return false;

    case state.COMPLETED:
      return !self.scraperIntervalElapsed(campaign, scraper, lastJob);

    case state.EXPIRED:
      return false;

    default:
      console.log('Job state not recognized: ' + lastJob.state + 
                  ' for campaign '+ JSON.stringify(campaign) +
                  ' and job ' + JSON.stringify(lastJob));
  }

  return false;
}

ScraperDispatcher.prototype.scraperIntervalElapsed = function(campaign, scraper, lastJob) {
  var finished = new Date(lastJob.finished);
  var intervalAgo = new Date.create('' + campaign.sweepIntervalMinutes + ' minutes ago');

  return finished.isBefore(intervalAgo);
}

ScraperDispatcher.prototype.scraperStartedForTooLong = function(campaign, scraper, lastJob) {
  var started = new Date(lastJob.started);
  var intervalAgo = new Date.create('' + 60 + ' minutes ago');

  return started.isBefore(intervalAgo);
}

ScraperDispatcher.prototype.scraperQueuedForTooLong = function(campaign, scraper, lastJob) {
  var created = new Date(lastJob._id.created);
  var intervalAgo = new Date.create('' + 60 * 6 + ' minutes ago');

  return created.isBefore(intervalAgo);
}

ScraperDispatcher.prototype.setJobAsExpired = function(job, reason) {
  self.jobs_.close(job, states.jobs.state.EXPIRED, reason);
}

ScraperDispatcher.prototype.createScraperJob = function(campaign, scraper) {
  var self = this;

  self.jobs_.push(campaign._id, scraper.name, {}, function(err, id) {
    if (err) {
      logJobWarn(campaign, scraper, 'Unable to create job: ' + err);
    } else {
      logJob(campaign, scraper, 'Successfully created job');
    }
  });
}

function logJob(campaign, scraper, log) {
  logger.info(campaign.name + ': ' + scraper.name + ': ' + log);
}

function logJobWarn(campaign, scraper, log) {
  logger.warn(campaign.name + ': ' + scraper.name + ': ' + log);
}