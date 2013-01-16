/*
 * scraper-dispatcher.js: the scraper-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches Scraper jobs for campaigns
 *
 */

var config = require('../../config')
  , events = require('events')
  , logger = require('../../logger').forFile('scraper-dispatcher.js')
  , states = require('../../states')
  , util = require('util')
  ;

var Scrapers = require('../scrapers');

var qActiveCampaigns = " \
  SELECT id, name, sweepintervalminutes, type, scrapersenabled, scrapersignored \
  FROM campaigns \
  WHERE \
    sweepenabled AND \
    sweepfromdate < current_timestamp AND \
    sweeptodate > current_timestamp \
;";

var qActiveJobs = " \
  SELECT DISTINCT ON (scraper) id, scraper, created, started, finished, state \
  FROM scraperjobs \
  WHERE \
    campaign = $1 \
  ORDER BY scraper, created DESC \
;";

var ScraperDispatcher = module.exports = function(postgres) {
  this.postgres_ = postgres;
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

  var query = self.postgres_.query(qActiveCampaigns);
  query.on('row', function(row) {
    self.checkCampaign(row);
  });
  query.on('error', logger.warn);
}

ScraperDispatcher.prototype.checkCampaign = function(campaign) {
  var self = this;

  var lastJobs = {};
  var query = self.postgres_.query(qActiveJobs, [campaign.id]);
  
  query.on('row', function(row) {
    lastJobs[row.scraper] = row;
  });

  query.on('end', self.enqueueJobsForCampaign.bind(self, campaign, lastJobs));
  
  query.on('error', function(error) {
    logger.warn('Unable to get last jobs for ' + campaign.name + ': ' + error);
  });
}

// For every scraper:
//   makeSureCanHandleThisCampaign();
//   makeSureDoesntHaveExistingJobs();
//   makeSureEnoughTimeHasPassedSinceLastCompleted();
//   createNewJob();
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
    if (self.scraperIgnoredByCampaign(campaign, scraper))
      return;

    if (self.scraperHasExistingValidJob(campaign, lastJobs, scraper))
      return;

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

  // It has a job logged, but is it valid?
  switch (lastJob.state) {
    case state.QUEUED:
    case state.PAUSED:
      return true;

    case state.COMPLETED:
    case state.CANCELLED:
    case state.ERRORED:
      return !self.scraperIntervalElapsed(campaign, scraper, lastJob);

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

ScraperDispatcher.prototype.createScraperJob = function(campaign, scraper) {
  console.log('creating job');
}

ScraperDispatcher.prototype.arrayFromPgArray = function(arrStr) {
  var clean = arrStr.substr(1, arrStr.length - 2);
  return clean.split(',');
}