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
  , db = acquire('database')
  , events = require('events')
  , ironmq = require('ironmq')
  , logger = acquire('logger').forFile('scraper-dispatcher.js')
  , mq = require('ironmq')(config.IRONMQ_TOKEN)(config.IRONMQ_PROJECT)
  , states = acquire('states')
  , util = require('util')
  ;

var Scrapers = acquire('scrapers');

var ScraperDispatcher = module.exports = function() {
  this.scrapers_;

  this.init();
}

util.inherits(ScraperDispatcher, events.EventEmitter);

ScraperDispatcher.prototype.init = function() {
  var self = this;

  self.scrapers_ = new Scrapers();
  if (self.scrapers_.isReady()) {
    self.start();
  } else {
    self.scrapers_.on('ready', self.start.bind(self));
  }

  logger.info('Running');
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

  var query = db.getActiveCampaigns();
  query.on('row', function(row) {
    self.checkCampaign(row);
  });
  query.on('error', logger.warn);
}

ScraperDispatcher.prototype.checkCampaign = function(campaign) {
  var self = this;

  var lastJobs = {};
  var query = db.getActiveJobs(campaign.id);
  
  query.on('row', function(row) {
    lastJobs[row.scraper] = row;
  });

  query.on('end', self.enqueueJobsForCampaign.bind(self, campaign, lastJobs));
  
  query.on('error', function(error) {
    logger.warn('Unable to get last jobs for ' + campaign.name + ': ' + error);
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

  if (campaign.scrapersenabled) {
    var enabled = self.arrayFromPgArray(campaign.scrapersenabled)
    console.log(enabled);
    return !enabled.any(scraper.name);
  }

  if (campaign.scrapersignored) {
    var ignored = self.arrayFromPgArray(campaign.scrapersignored)
    return ignored.any(scraper.name);
  }

  return false;
}

ScraperDispatcher.prototype.scraperHasExistingValidJob = function(campaign, lastJobs, scraper) {
  var self = this;
  var state = states.scraper.jobState;

  var lastJob = lastJobs[scraper.name];
  if (!lastJob)
    return false;

  logJob(campaign, scraper, 'Inspecting existing job ' + lastJob.id);

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
  var intervalAgo = new Date.create('' + campaign.sweepintervalminutes + ' minutes ago');

  return finished.isBefore(intervalAgo);
}

ScraperDispatcher.prototype.scraperStartedForTooLong = function(campaign, scraper, lastJob) {
  var started = new Date(lastJob.started);
  var intervalAgo = new Date.create('' + 60 + ' minutes ago');

  return started.isBefore(intervalAgo);
}

ScraperDispatcher.prototype.scraperQueuedForTooLong = function(campaign, scraper, lastJob) {
  var created = new Date(lastJob.created);
  var intervalAgo = new Date.create('' + 60 * 12 + ' minutes ago');

  return created.isBefore(intervalAgo);
}

ScraperDispatcher.prototype.setJobAsExpired = function(lastJob, reason) {
  db.closeJob(lastJob.id, states.scraper.jobState.EXPIRED, reason);
}

// Add job to queue
// Add job to database
ScraperDispatcher.prototype.createScraperJob = function(campaign, scraper) {
  var self = this;

  logJob(campaign, scraper, 'Creating job');

  var msg = {};
  msg.campaignId = campaign.id;
  msg.scraper = scraper.name;
  msg.type = campaign.type;
  msg.created = new Date();
  // Stick timeout in message as bindings behave weirdly wrt timeout on msg replies
  msg.timeout = config.SCRAPER_JOB_TIMEOUT_SECONDS;

  var options = {};
  options.timeout = config.SCRAPER_JOB_TIMEOUT_SECONDS;
  options.expires_in = config.SCRAPER_JOB_EXPIRES_SECONDS;
 
  mq.queues(config.SCRAPER_QUEUE).put(JSON.stringify(msg), options, function(err, obj) {
    if (err || obj === undefined || obj.ids === undefined) {
      logJobWarn(campaign, scraper, 'Unable to create job: ' + err);
      return;
    }

    var query = db.insertJob(campaign.id, scraper.name, { msgId: obj.ids[0], test: "\"hello\"" });
    query.on('error', function(err) {
      if (err) {
        logJobWarn(campaign, scraper, 'Unable to insert job: ' + err);
      }
    });
    query.on('end', function() {
      logJob(campaign, scraper, 'Successfully created job ' + obj.ids[0]);
    });
  });
}

ScraperDispatcher.prototype.arrayFromPgArray = function(arrStr) {
  var clean = arrStr.substr(1, arrStr.length - 2);
  return clean.split(',');
}

function logJob(campaign, scraper, log) {
  logger.info(campaign.name + ': ' + scraper.name + ': ' + log);
}

function logJobWarn(campaign, scraper, log) {
  logger.warn(campaign.name + ': ' + scraper.name + ': ' + log);
}