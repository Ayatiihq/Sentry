/*
 * index.js: the scraper role
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper is the general link scraping role.
 *
 */

var config = require('../../config')
  , events = require('events')
  , logger = require('../../logger').forFile('index.js')
  , pg = require('pg').native  
  , mq = require('ironmq')(config.IRONMQ_TOKEN)(config.IRONMQ_PROJECT)
  , states = require('../../states')  
  , util = require('util')
  ;

var Role = require('../role')
  , Scrapers = require('../scrapers')

var QUEUE_CHECK_INTERVAL = 1000 * 5;

var qDeleteJob = " \
  UPDATE scraperjobs \
  SET \
    state = $1, \
    started = current_timestamp, \
    finished = current_timestamp, \
    properties = properties || '\"reason\"=>\"%s\"' \
  WHERE \
    properties->'msgId' = '%s' \
;";

var Scraper = module.exports = function() {
  this.postgres_ = null;
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
  pg.connect(config.DATABASE_URL, this.onDatabaseConnection.bind(this));  
}

Scraper.prototype.onDatabaseConnection = function(error, client) {
  var self = this;

  if (error) {
    console.log('Unable to connect to the database, exiting', error);
    self.emit('error', error);
    return;
  }

  self.postgres_ = client;

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

  if (!self.scrapers_.has(job.body.scraper, job.body.type)) {
    err = new Error(util.format('No match for %s and %s', job.body.scraper, job.body.type));
  }

  callback(err);
}

Scraper.prototype.getJobDetails = function(job, callback) {
  callback(new Error('ollo'));
}

Scraper.prototype.startJob = function(job) {
  logger.info('Starting job '  + job.id);
}

Scraper.prototype.deleteJob = function(err, job) {
  var self = this;

  logger.info('Cancelling job ' + job.id);

  err = err ? err : "unknown";

  // Compile the query with variables that don't work through node-postgres
  var query = util.format(qDeleteJob, err, job.id);
  self.postgres_.query(query,
                       [states.scraper.jobState.CANCELLED],
                       function(err, result) {
                         if (err)
                          logger.warn('Unable to cancel job ' + job.id + ': ' + err);
                       });

  // Delete the job from the queue
  job.queue_.del(job.id, function(err) {
    if (err) logger.warn(utils.formate('Unable to remove job (%s) from queue: %s', job.id, err));
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
  if (self.postgres_)
    self.findJobs();

  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}