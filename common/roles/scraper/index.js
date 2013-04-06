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
  , Role = acquire('role')
  , Scrapers = acquire('scrapers')
  , Seq = require('seq')
  ;
 
var Scraper = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;

  this.scrapers_ = null;
  this.started_ = false;

  this.runningScrapers_ = [];

  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('scraper');
  self.scrapers_ = new Scrapers();
}

Scraper.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  logger.info('Processing %j', job._id);

  // Sanitize the scraper name
  job.scraperName_ = job._id.consumer.split('.')[0];

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }

  Seq()
    .seq('Job has details', function() {
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq('Job is valid', function(campaign) {
      job.campaign = campaign;
      self.checkJobValidity(job, this);
    })
    .seq('Start job', function() {
      self.startJob(job, this);
    })
    .seq('Done', function() {
      logger.info('Finished all work');
      self.emit('finished');
    })
    .catch(onError)
    ;

  process.on('uncaughtException', onError);
}

Scraper.prototype.checkJobValidity = function(job, callback) {
  var self = this
    , err = null
    ;

  if (!self.scrapers_.hasScraperForType(job.scraperName_, job.campaign.type)) {
    err = new Error(util.format('No match for %s and %s', job.scraperName_, job.campaign.type));
  }
  callback(err);
}

Scraper.prototype.startJob = function(job, done) {
  var self = this;
  
  self.loadScraperForJob(job, function(err, scraper) {
    if (err)
      return done(err);

    self.runScraper(scraper, job, done);
  });
}

Scraper.prototype.loadScraperForJob = function(job, callback) {
  var self = this;

  logger.info('Loading scraper %s for job %j', job.scraperName_, job);

  var scraperInfo = self.scrapers_.getScraper(job.scraperName_);
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

Scraper.prototype.runScraper = function(scraper, job, done) {
    var self = this;

    // Save the callback so we can call it when necessary
    job.done = done;
    scraper.job = job;

    logger.info('Running job %j', job._id);

    self.runningScrapers_.push(scraper);
    scraper.on('started', self.onScraperStarted.bind(self, scraper, job));
    scraper.on('finished', self.onScraperFinished.bind(self, scraper, job));
    scraper.on('error', self.onScraperError.bind(self, scraper, job));

    var campaign = job.campaign;
    scraper.on('infringement', self.onScraperInfringement.bind(self, scraper, campaign));
    scraper.on('metaInfringement', self.onScraperMetaInfringement.bind(self, scraper, campaign));
    scraper.on('relation', self.onScraperRelation.bind(self, scraper, campaign));
    scraper.on('metaRelation', self.onScraperMetaRelation.bind(self, scraper, campaign));
    scraper.on('infringementStateChange', self.onScraperStateChange.bind(self, scraper));
    scraper.on('infringementPointsUpdate', self.onScraperPointsUpdate.bind(self, scraper));
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
  var err = new Error(util.format('Scraper took too long to start: %s', scraper.job._id.consumer));

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
      self.jobs_.touch(job);
    }
  });
}

Scraper.prototype.onScraperStarted = function(scraper, job) {
  var self = this;

  if (scraper.watchId) {
    clearTimeout(scraper.watchId);
    scraper.watchId = -1;
  }

  self.jobs_.start(job, function(err) {
    if (err)
      logger.warn('Unable to make job as started %j: %s', job._id, err);
  });
}

Scraper.prototype.onScraperFinished = function(scraper, job) {
  var self = this;

  self.jobs_.complete(job, function(err) {
    if (err)
      logger.warn('Unable to make job as complete %j: %s', job._id, err);
  });
  self.cleanup(scraper, job);
  job.done();
}

Scraper.prototype.onScraperError = function(scraper, job, jerr) {
  var self = this;
  jerr = jerr ? jerr : new Error('unknown');
  jerr = Object.isString(jerr) ? new Error(jerr) : jerr;

  logger.warn('Scraper error: %s', jerr);
  logger.warn(jerr.stack);

  self.jobs_.close(job, states.jobs.state.ERRORED, jerr, function(err) {
    if (err)
      logger.warn('Unable to make job as errored %j: %s', job._id, err);
  });

  self.cleanup(scraper, job);
  job.done();
}

Scraper.prototype.cleanup = function(scraper, job) {
  var self = this;

  clearTimeout(scraper.longId);
  clearTimeout(scraper.watchId);
  self.runningScrapers_.remove(scraper);
}

Scraper.prototype.onScraperInfringement = function(scraper, campaign, uri, points, metadata) {
  var self = this
    , state = states.infringements.state.UNVERIFIED
    ;
  self.infringements_.add(campaign, uri, campaign.type, scraper.job._id.consumer, state, points, metadata, function(err) {
    if (err) {
      logger.warn('Unable to add an infringement: %j %s %s %s', campaign._id, uri, points, err);
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
  self.infringements_.add(campaign, uri, campaign.type, scraper.job._id.consumer, scrapeState, points, metadata, function(err) {
    if (err) {
      logger.warn('Unable to add an infringement: %j %s %s %s', campaign._id, uri, points, err);
    }
  });

  self.infringements_.addMeta(campaign, uri, campaign.type, scraper.job._id.consumer, unverifiedState, metadata, function(err, id) {
    if (err) {
      logger.warn('Unable to add an meta infringement: %j %s %s %s', campaign._id, uri, metadata, err);
    }
  });
}

Scraper.prototype.onScraperRelation = function(scraper, campaign, sourceUri, targetUri) {
  var self = this;

  self.infringements_.addRelation(campaign, sourceUri, targetUri, function(err, id) {
    if (err) {
      logger.warn('Unable to add relation: %j %s %s %s', campaign._id, sourceUri, targetUri, err);
    }
  });
}

Scraper.prototype.onScraperMetaRelation = function(scraper, campaign, uri) {
  var self = this
    , source = scraper.job._id.consumer
    ;

  self.infringements_.addMetaRelation(campaign, uri, source, function(err, id) {
    if (err) {
      logger.warn('Unable to add relation: %j %s %s %s', campaign._id, uri, source, err);
    }
  });
}

Scraper.prototype.onScraperPointsUpdate = function(scraper, infringement, source, points, message) {
  var self = this;

  self.infringements_.addPoints(infringement, source, points, message, function(err, id){
    if(err) {
      logger.warn("Unable to update points on infringement: %s %s %s", scraper.job._id.consumer, infringement.uri, source);
    }
  });
}

Scraper.prototype.onScraperStateChange = function(scraper, infringement, newState) {
  var self = this;

  self.infringements_.setState(infringement, newState, function(err){
    if(err) {
      logger.warn("Unable to change state on infringement: %s %s %i", scraper.job._id.consumer, infringement.uri, newState);
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
  self.jobs_.pop(self.processJob.bind(self));
  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}