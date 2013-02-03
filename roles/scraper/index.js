/*
 * index.js: the scraper role
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper is the general link scraping role.
 *
 */
var acquire = require('acquire')
  , config = acquire('config')
  , db = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('index.js')
  , mq = require('ironmq')(config.IRONMQ_TOKEN)(config.IRONMQ_PROJECT)
  , states = acquire('states')  
  , util = require('util')
  ;

var Role = acquire('role')
  , Scrapers = acquire('scrapers')

var QUEUE_CHECK_INTERVAL = 1000 * 5;

var Scraper = module.exports = function() {
  this.db_ = null;
  this.scrapers_ = null;
  this.started_ = false;

  this.queue_ = mq.queues(config.SCRAPER_QUEUE);
  this.priorityQueue_ = mq.queues(config.SCRAPER_QUEUE_PRIORITY);

  this.poll = 0;

  this.runningScrapers_ = [];

  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;

  self.scrapers_ = new Scrapers();

  if (!db.isReady())
    db.on('ready', self.onDatabaseReady.bind(self));
}

Scraper.prototype.onDatabaseReady = function() {
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

  var query = db.getJobDetails(job.id);
  query.on('row', function(details) {
    job.details = details;
    callback(null);
  });

  query.on('error', function(err) {
    callback(err);
  });  
}


Scraper.prototype.startJob = function(job) {
  var self = this;
  var jobState = states.scraper.jobState;

  self.loadScraperForJob(job, function(err, scraper) {
    if (err) {
      logger.warn(util.format('Unable to start job %s: %s', job.id, err));
      db.closeJob(job.id, jobState.ERRORED, err);
      self.findJobs();
      return;
    }
    
    logger.info('Starting job '  + job.id);

    self.runningScrapers_.push(scraper);

    scraper.on('started', self.onScraperStarted.bind(self, scraper, job));
    scraper.on('paused', self.onScraperPaused.bind(self, scraper, job));
    scraper.on('finished', self.onScraperFinished.bind(self, scraper, job));
    scraper.on('error', self.onScraperError.bind(self, scraper, job));

    self.doScraperStartWatch(scraper, job);
    scraper.start();
  });
}

Scraper.prototype.loadScraperForJob = function(job, callback) {
  var self = this;

  var scraperInfo = self.scrapers_.getScraper(job.body.scraper);
  if (!scraperInfo) {
    callback(new Error('Unable to find scraper'));
    return;
  }

  try {
    var modPath = './scrapers/' + scraperInfo.name;
    var Scraper = require(modPath);
    scraper = new Scraper();
    callback(null, scraper);

  } catch(err) {
    callback(err);
  }
}

Scraper.prototype.deleteJob = function(err, job) {
  var self = this;

  logger.info('Cancelling job ' + job.id);

  err = err ? err : "unknown";

  var query = db.closeJob(job.id, states.scraper.jobState.CANCELLED, err);
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

Scraper.prototype.doScraperStartWatch = function(scraper, job) {
  var self = this;
  var err = new Error(util.format('Scraper took too long to start: %s', scraper.getName()));

  scraper.watchId = setTimeout(self.onScraperError.bind(self, scraper, job, err),
                               1000 * 60);
}

Scraper.prototype.onScraperStarted = function(scraper, job) {
  var self = this;

  if (scraper.watchId) {
    clearTimeout(scraper.watchId);
    scraper.watchId = -1;
  }

  var query = db.startJob(job.id, {});
  query.on('error', function(err) {
    logger.warn(util.format('Unable to mark job (%s) as started', job.id));
  });
}

Scraper.prototype.onScraperPaused = function(scraper, job, state) {
  var self = this;

  var query = db.pauseJob(job.id, state);
  query.on('error', function(err) {
    logger.warn(util.format('Unable to mark job (%s) as paused: %s', job.id, err));
  });

  self.findJobs();
}

Scraper.prototype.onScraperFinished = function(scraper, job) {
  var self = this;

  var query = db.finishJob(job.id, {});
  query.on('error', function(err) {
    logger.warn(util.format('Unable to mark job (%s) as finished: %s', job.id, err));
  });

  self.findJobs();
}

Scraper.prototype.onScraperError = function(scraper, job, jerr) {
  var self = this;

  var query = db.closeJob(job.id, states.scraper.jobState.ERRORED, jerr);
  query.on('error', function(err) {
    logger.warn(util.format('Unable to mark job (%s) as errored (%s): %s', job.id, jerr, err));
  });

  self.findJobs();
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