/*
 * index.js: the scraper role
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper is the general link scraping role.
 *
 */

var config = require('../../config')
  , db = require('../database')
  , events = require('events')
  , logger = require('../../logger').forFile('index.js')
  , mq = require('ironmq')(config.IRONMQ_TOKEN)(config.IRONMQ_PROJECT)
  , states = require('../../states')  
  , util = require('util')
  ;

var Role = require('../role')
  , Scrapers = require('../scrapers')

var QUEUE_CHECK_INTERVAL = 1000 * 5;

var Scraper = module.exports = function() {
  this.db_ = null;
  this.scrapers_ = null;
  this.started_ = false;

  this.queue_ = mq.queues(config.SCRAPER_QUEUE);
  this.priorityQueue_ = mq.queues(config.SCRAPER_QUEUE_PRIORITY);

  this.poll = 0;

  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;

  self.scrapers_ = new Scrapers();

  if (!db.isReady())
    db.on('ready', self.onDatabaseReady.bind(self));
}

Scraper.prototype.onDatabaseReady = function(error, client) {
  var self = this;

  if (self.started_)
    self.findJobs();
}

Scraper.prototype.findJobs = function() {
  var self = this;

  if (self.poll)
    return;

  self.poll = setTimeout(self.checkAvailableJob.bind(self), QUEUE_CHECK_INTERVAL);
  logger.info('Job search enqueued');
}

Scraper.prototype.checkAvailableJob = function() {
  var self = this;

  self.poll = 0;

  logger.info('Checking priority queue');
  self.priorityQueue_.get(function(err, msgs) {
    if (err || !msgs || !msgs.length) {
      if (err) logger.warn(err);

      logger.info('Checking default queue');
      self.queue_.get(function(err, msgs) {
        if (err) {
          logger.warn(err);
          self.findJobs();
        } else if (!msgs || !msgs.length) {
          self.findJobs();
        } else {
          self.processJobs(self.queue_, msgs);
        }
      });
    } else {
      self.processJobs(self.priorityQueue_, msgs);
    }
  });
}

Scraper.prototype.processJobs = function(queue, jobs) {
  var self = this;
  var nJobsProcessing = jobs.length;

  function handleFail(err, job) {
    logger.warn(err);

    nJobsProcessing -= 1;
    self.deleteJob(err, job);

    if (nJobsProcessing < 1) {
      self.findJobs();
    }
  }

  jobs.forEach(function(job) {
    logger.info('Processing ' + JSON.stringify(job));

    job.queue_ = queue;

    var j = job;
    j.body = JSON.parse(j.body);

    self.checkJobValidity(j, function(err) {
      if (err) {
        handleFail(err, j);
        return;
      }

      self.getJobDetails(j, function(err) {
        if (err) {
          handleFail(err, j);
          return;
        }

        self.startJob(j);
      });
    });
  });
}

Scraper.prototype.checkJobValidity = function(job, callback) {
  var self = this
    , err = null
    ;

  if (!self.scrapers_.hasScraperForType(job.body.scraper, job.body.type)) {
    err = new Error(util.format('No match for %s and %s', job.body.scraper, job.body.type));
  }

  callback(err);
}

Scraper.prototype.getJobDetails = function(job, callback) {
  var self = this;

  var q = db.getJobDetails(job.id);
  q.on('row', function(details) {
    job.details = details;
    callback(null);
  });

  q.on('error', function(err) {
    callback(err);
  });  
}


Scraper.prototype.startJob = function(job) {
  logger.info('Starting job '  + job.id);
  logger.info(job.details);
}

Scraper.prototype.deleteJob = function(err, job) {
  var self = this;

  logger.info('Cancelling job ' + job.id);

  err = err ? err : "unknown";

  var query = db.deleteJob(job.id, states.scraper.jobState.CANCELLED, err);
  query.on('error', function(err) {
    if (err) {
      logger.warn('Unable to cancel job ' + job.id + ': ' + err);
    }
  });

  query.on('end', function() {
    // Delete the job from the queue now
    job.queue_.del(job.id, function(err) {
      if (err) {
        logger.warn(utils.format('Unable to remove job (%s) from queue: %s', job.id, err));
      }
    });
  });
}

//
// Overrides
//
Scraper.prototype.getName = function() {
  return "scraperRole";
}

Scraper.prototype.getDisplayName = function() {
  return "Scraper Role";
}

Scraper.prototype.start = function() {
  var self = this;

  self.started_ = true;
  if (db.isReady())
    self.findJobs();

  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}