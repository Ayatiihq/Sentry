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
  , events = require('events')
  , logger = acquire('logger').forFile('index.js')
  , states = acquire('states')  
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Queue = acquire('queue')
  , Role = acquire('role')
  , Scrapers = acquire('scrapers')

var MAX_QUEUE_POLLS = 1
  , QUEUE_CHECK_INTERVAL = 1000 * 10
  ;
  
var Scraper = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.queue_ = null;
  this.priorityQueue_ = null;

  this.scrapers_ = null;
  this.started_ = false;

  this.poll = 0;

  this.queuePolls_ = 0;

  this.runningScrapers_ = [];

  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('scraper');
  self.queue_ = new Queue(config.SCRAPER_QUEUE);
  self.priorityQueue_ = new Queue(config.SCRAPER_QUEUE_PRIORITY);
  self.scrapers_ = new Scrapers();
}

Scraper.prototype.findJobs = function() {
  var self = this;

  if (self.poll || self.runningScrapers_.length)
    return;

  self.poll = setTimeout(self.checkAvailableJob.bind(self), QUEUE_CHECK_INTERVAL);
  logger.info('Job search enqueued');
}

Scraper.prototype.checkAvailableJob = function() {
  var self = this;

  if (self.queuePolls_ >= MAX_QUEUE_POLLS)
    return self.emit('finished');

  self.queuePolls_ += 1;

  self.poll = 0;

  logger.info('Checking priority queue');
  self.priorityQueue_.pop(function(err, message) {
    if (err || !message) {
      if (err)
        logger.warn('Unable to check priority queue: ' + err);

      logger.info('Checking default queue');
      self.queue_.pop(config.SCRAPER_JOB_TIMEOUT_SECONDS, function(err, message) {
        if (err) {
          logger.warn(err);
          self.findJobs();
        } else if (!message) {
          self.findJobs();
        } else {
          self.processJobs(self.queue_, [message]);
        }
      });
    } else {
      self.processJobs(self.priorityQueue_, [message]);
    }
  });
}

Scraper.prototype.processJobs = function(queue, jobs) {
  var self = this;
  var nJobsProcessing = jobs.length;

  function handleFail(err, job) {
    logger.warn(err);

    nJobsProcessing -= 1;
    self.jobs_.close(job.body.campaignId, job.body.jobId, states.jobs.state.CANCELLED, err.toString());
    job.queue_.delete(job);

    if (nJobsProcessing < 1) {
      self.findJobs();
    }
  }

  jobs.forEach(function(job) {
    logger.info('Processing ' + JSON.stringify(job));

    job.queue_ = queue;

    var j = job;
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

  self.jobs_.getDetails(job.body.campaignId, job.body.jobId, function(err, details) {
    job.details = details;
    if (!err) {
      if (job.details && job.details.state) {
        var state = parseInt(job.details.state)
          , s = states.jobs.state;
        if (state != s.QUEUED && state != s.PAUSED)
          err = new Error('Job (' + job.body.jobId + ') does not have a ready state: ' + state);
      } else {
        err = new Error('Unable to get job details: ' + job.body.jobId);
      }
    }

    if (!err) {
      self.campaigns_.getDetails(job.body.clientId, job.body.campaignId, function(err, campaign) {
        job.campaign = campaign;
        if (!(job.campaign && job.campaign.type))
          err = new Error('Unable to get campaign details');
        callback(err);
      });
    } else {
      callback(err);
    }
  });
}

Scraper.prototype.startJob = function(job) {
  var self = this;
  self.loadScraperForJob(job, function(err, scraper) {
    if (err) {
      var jobState = states.jobs.state;

      logger.warn(util.format('Unable to start job %s: %s', job.id, err));
      self.jobs_.close(job.body.campaignId, job.body.jobId, jobState.ERRORED, err);
      job.queue_.delete(job);
      self.findJobs();
      return;
    }
    self.runScraper(scraper, job);
  });
}

Scraper.prototype.loadScraperForJob = function(job, callback) {
  var self = this;

  logger.info('Loading scraper %s for job %s', job.body.scraper, job);

  var scraperInfo = self.scrapers_.getScraper(job.body.scraper);
  if (!scraperInfo) {
    callback(new Error('Unable to find scraper'));
    return;
  }

  var scraper = null;
  var err = null;
  try {
    scraper = self.scrapers_.loadScraper(scraperInfo.name);
  } catch(error) {
    err = error;
  }

  callback(err, scraper);
}

Scraper.prototype.runScraper = function(scraper, job) {
    var self = this;
    logger.info('Running job '  + job.body.jobId);
    self.runningScrapers_.push(scraper);
    scraper.on('started', self.onScraperStarted.bind(self, scraper, job));
    scraper.on('paused', self.onScraperPaused.bind(self, scraper, job));
    scraper.on('finished', self.onScraperFinished.bind(self, scraper, job));
    scraper.on('error', self.onScraperError.bind(self, scraper, job));

    var campaign = job.campaign;
    scraper.on('infringement', self.onScraperInfringement.bind(self, scraper, campaign));
    scraper.on('metaInfringement', self.onScraperMetaInfringement.bind(self, scraper, campaign));
    scraper.on('relation', self.onScraperRelation.bind(self, scraper, campaign));
    scraper.on('metaRelation', self.onScraperMetaRelation.bind(self, scraper, campaign));
    scraper.on('infringementStateChange', self.onScraperStateChange.bind(self, scraper));
    self.doScraperStartWatch(scraper, job);
    self.doScraperTakesTooLongWatch(scraper, job);
    
    try {
      scraper.start(campaign, job);
    } catch(err) {
      self.onScraperError(scraper, job, err);
    }
}

Scraper.prototype.doScraperStartWatch = function(scraper, job) {
  var self = this;
  var err = new Error(util.format('Scraper took too long to start: %s', scraper.getName()));

  scraper.watchId = setTimeout(self.onScraperError.bind(self, scraper, job, err),
                               1000 * 60);
}

Scraper.prototype.doScraperTakesTooLongWatch = function(scraper, job) {
  var self = this;

  scraper.longId = setInterval(self.isScraperStalled.bind(self, scraper, job),
                               1000 * (config.SCRAPER_JOB_TIMEOUT_SECONDS / 2));
}

Scraper.prototype.isScraperStalled = function(scraper, job) {
  var self = this;

  function timedOut(err) {
    err = err ? err : new Error('unknown');
    self.onScraperError(scraper, job, err);
  }

  var id = setTimeout(timedOut, 1000 * (config.SCRAPER_JOB_TIMEOUT_SECONDS / 4));

  scraper.isAlive(function(err) {
    clearTimeout(id);

    if (err) {
      timedOut(err);
    } else {
      job.queue_.touch(job, config.SCRAPER_JOB_TIMEOUT_SECONDS);
    }
  });
}

Scraper.prototype.onScraperStarted = function(scraper, job) {
  var self = this;

  if (scraper.watchId) {
    clearTimeout(scraper.watchId);
    scraper.watchId = -1;
  }

  self.jobs_.start(job.body.campaignId, job.body.jobId, function(err) {
    if (err)
      logger.warn('Unable to make job as started ' + job.body.jobId + ': ' + err);
  });
}

Scraper.prototype.onScraperPaused = function(scraper, job, snapshot) {
  var self = this;

  self.jobs_.pause(job.body.campaignId, job.body.jobId, state, function(err) {
    if (err)
      logger.warn('Unable to make job as paused ' + job.body.jobId + ': ' + err);
  });
  self.cleanup(scraper, job);
  self.findJobs();
}

Scraper.prototype.onScraperFinished = function(scraper, job) {
  var self = this;

  self.jobs_.complete(job.body.campaignId, job.body.jobId, function(err) {
    if (err)
      logger.warn('Unable to make job as complete ' + job.body.jobId + ': ' + err);
  });
  job.queue_.delete(job);
  self.cleanup(scraper, job);
  self.findJobs();
}

Scraper.prototype.onScraperError = function(scraper, job, jerr) {
  var self = this;
  jerr = jerr ? jerr : new Error('unknown');

  logger.warn('Scraper error: ' + jerr);
  self.jobs_.close(job.body.campaignId, job.body.jobId, states.jobs.state.ERRORED, jerr.toString(), function(err) {
    if (err)
      logger.warn('Unable to make job as errored ' + job.body.jobId + ': ' + err);
  });
  job.queue_.delete(job);
  self.cleanup(scraper, job);
  self.findJobs();
}

Scraper.prototype.cleanup = function(scraper, job) {
  var self = this;

  clearTimeout(scraper.longId);
  clearTimeout(scraper.watchId);
  self.runningScrapers_.remove(scraper);
}

Scraper.prototype.onScraperInfringement = function(scraper, campaign, uri, metadata) {
  var self = this
    , state = states.infringements.state.UNVERIFIED
    ;
  self.infringements_.add(campaign, uri, campaign.type, scraper.getName(), state, metadata, function(err) {
    if (err) {
      logger.warn('Unable to add an infringement: %s %s %s %s', campaign, uri, metadata, err);
    }
  });
}

Scraper.prototype.onScraperMetaInfringement = function(scraper, campaign, uri, points, metadata) {
  var self = this
    , scrapeState = states.infringements.state.NEEDS_SCRAPE
    , unverifiedState= states.infringements.state.UNVERIFIED
    ;

  // We create a normal infringement too
  // FIXME: Check blacklists and spiders before adding infringement
  self.infringements_.add(campaign, uri, campaign.type, scraper.getName(), scrapeState, points, metadata, function(err) {
    if (err) {
      logger.warn('Unable to add an infringement: %s %s %s %s', campaign, uri, metadata, err);
    }
  });

  self.infringements_.addMeta(campaign, uri, scraper.getName(), unverifiedState, metadata, function(err, id) {
    if (err) {
      logger.warn('Unable to add an meta infringement: %s %s %s %s', campaign, uri, metadata, err);
    }
  });
}

Scraper.prototype.onScraperRelation = function(scraper, campaign, sourceUri, targetUri) {
  var self = this;

  self.infringements_.addRelation(campaign, sourceUri, targetUri, function(err, id) {
    if (err) {
      logger.warn('Unable to add relation: %s %s %s %s', campaign, sourceUri, targetUri, err);
    }
  });
}

Scraper.prototype.onScraperMetaRelation = function(scraper, campaign, uri) {
  var self = this
    , source = scraper.getName()

  self.infringements_.addMetaRelation(campaign, addMetaRelation, source, function(err, id) {
    if (err) {
      logger.warn('Unable to add relation: %s %s %s %s', campaign, addMetaRelation, source, err);
    }
  });
}

Scraper.prototype.onScraperStateChange = function(scraper, infringement, newState) {
  var self = this;

  self.infringements.changeState(infringement, newState, function(err, id){
    if(err){
      logger.warn("Unable to change state on infringement: %s %s %i", scraper.getName(), infringement.uri, newState);
    }
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
  self.findJobs();
  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}