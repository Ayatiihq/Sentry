/*
 * spider-dispatcher.js: the spider-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches Spider jobs
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('spider-dispatcher.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Jobs = acquire('jobs')
  , Seq = require('seq')
  , Spiders = acquire('spiders');

var SWEEP_INTERVAL_MINUTES = 60 * 3;

var SpiderDispatcher = module.exports = function() {
  this.jobs_ = null;
  this.spiders_ = null;

  this.init();
}

util.inherits(SpiderDispatcher, events.EventEmitter);

SpiderDispatcher.prototype.init = function() {
  var self = this;

  self.jobs_ = new Jobs('spider');

  self.spiders_ = new Spiders();
  if (self.spiders_.isReady()) {
    self.start();
  } else {
    self.spiders_.on('ready', self.start.bind(self));
  }
}

SpiderDispatcher.prototype.start = function() {
  var self = this;

  setInterval(self.iterateSpiders.bind(self),
              config.GOVERNOR_SPIDER_CHECK_DELAY_MINUTES * 60 * 1000);

  // Kick off the first one
  self.iterateSpiders();
}

SpiderDispatcher.prototype.iterateSpiders = function() {
  var self = this
    , spiders = self.spiders_.getSpiders()
    ;

  spiders.forEach(function(spider) {
    self.checkSpider(spider);
  });
}

SpiderDispatcher.prototype.checkSpider = function(spider) {
  var self = this;

  self.jobs_.listActiveJobs(spider.name, function(err, jobs, mappedJobs) {
    if (err) {
      logWarn(spider, err);
      return;
    }
    self.enqueueJobsForSpider(spider, mappedJobs);
  });
}

SpiderDispatcher.prototype.enqueueJobsForSpider = function(spider, lastJobs) {
  var self = this;

  log(spider, 'Checking job status');

  if (self.spiderHasExistingValidJob(spider, lastJobs)) {
    log(spider, 'Existing job in progress');
    return;
  }

  self.createSpiderJob(spider);
}

SpiderDispatcher.prototype.spiderHasExistingValidJob = function(spider, lastJobs) {
  var self = this;
  var state = states.jobs.state;

  var lastJob = lastJobs[spider.name];
  if (!lastJob)
    return false;

  log(spider, 'Inspecting existing job ' + lastJob.RowKey + ' state: ' + lastJob.state);

  // It has a job logged, but is it valid?
  switch (lastJob.state) {
    case state.QUEUED:
      var jobValid = !self.spiderQueuedForTooLong(spider, lastJob);
      if (!jobValid) {
        self.setJobAsExpired(lastJob, "Queued/Paused for too long");
      }
      return jobValid;

    case state.STARTED:
      var jobValid = !self.spiderPoppedForTooLong(spider, lastJob);
      if (!jobValid) {
        self.setJobAsExpired(lastJob, "Popped for too long");
      }
      return jobValid;

    case state.PAUSED:
    case state.CANCELLED:
    case state.ERRORED:
      return false;

    case state.COMPLETED:
      return !self.spiderIntervalElapsed(spider, lastJob);

    case state.EXPIRED:
      return false;

    default:
      logger.warn('Job state not recognized: ' + lastJob.state + 
                  ' and job ' + JSON.stringify(lastJob));
  }

  return false;
}

SpiderDispatcher.prototype.spiderIntervalElapsed = function(spider, lastJob) {
  var finished = new Date(lastJob.finished);
  var intervalAgo = new Date.create('' + SWEEP_INTERVAL_MINUTES + ' minutes ago');

  return finished.isBefore(intervalAgo);
}

SpiderDispatcher.prototype.spiderPoppedForTooLong = function(spider, lastJob) {
  var popped = new Date(lastJob.started);
  var intervalAgo = new Date.create((config.SPIDER_JOB_TIMEOUT_SECONDS * 2) + ' minutes ago');

  return popped.isBefore(intervalAgo);
}

SpiderDispatcher.prototype.spiderQueuedForTooLong = function(spider, lastJob) {
  var created = new Date(lastJob._id.created);
  var intervalAgo = new Date.create('' + 60 * 12 + ' minutes ago');

  return created.isBefore(intervalAgo);
}

SpiderDispatcher.prototype.setJobAsExpired = function(job, reason) {
  var self = this;
  self.jobs_.close(job, states.jobs.state.EXPIRED, reason);
}

// Add job to database
// Add job to queue
SpiderDispatcher.prototype.createSpiderJob = function(spider) {
  var self = this;

  self.jobs_.push(spider.name, '', {}, function(err, id) {
    if (err) {
      logJobWarn(spider, 'Unable to create job: ' + err);
    } else {
      log(spider, 'Successfully created job');
    }
  });
}

function log(spider, log) {
  logger.info(spider.name + ': ' + log);
}

function logWarn(spider, log) {
  logger.warn(spider.name + ': ' + log);
}