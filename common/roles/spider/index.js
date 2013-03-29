/*
 * index.js: the  role
 *
 * (C) 2012 Ayatii Limited
 *
 * Spider is the general link scraping role.
 *
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('index.js')
  , states = acquire('states')  
  , util = require('util')
  ;

var Jobs = acquire('jobs')
  , Links = acquire('links')
  , Queue = acquire('queue')
  , Role = acquire('role')
  , Spiders = acquire('spiders')
  , Seq = require('seq')
  ;

var MAX_QUEUE_POLLS = 1
  , QUEUE_CHECK_INTERVAL = 1000 * 60
  ;

var Spider = module.exports = function() {
  this.jobs_ = null;
  this.links_ = null;
  this.queue_ = null;
  this.priorityQueue_ = null;

  this.spiders_ = null;
  this.started_ = false;

  this.poll = 0;

  this.runningSpiders_ = [];

  this.queuePolls_ = 0;

  this.init();
}

util.inherits(Spider, Role);

Spider.prototype.init = function() {
  var self = this;

  self.jobs_ = new Jobs('spider');
  self.links_ = new Links();  
  self.queue_ = new Queue(config.SPIDER_QUEUE);
  self.priorityQueue_ = new Queue(config.SPIDER_QUEUE_PRIORITY);
  self.spiders_ = new Spiders();
}

Spider.prototype.findJobs = function() {
  var self = this;

  if (self.poll)
    return;

  self.poll = setTimeout(self.checkAvailableJob.bind(self), QUEUE_CHECK_INTERVAL);
  logger.info('Job search enqueued');
}

Spider.prototype.checkAvailableJob = function() {
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
      self.queue_.pop(config.SPIDER_JOB_TIMEOUT_SECONDS, function(err, message) {
        if (err) {
          logger.warn(err);
          self.findJobs();
        } else if (!message) {
          self.findJobs();
        } else {
          self.processJobs(self.queue_, message);
        }
      });
    } else {
      self.processJobs(self.priorityQueue_, message);
    }
  });
}

Spider.prototype.processJobs = function(queue, job) {
  var self = this;

  logger.info('Processing ' + JSON.stringify(job));

  job.queue_ = queue;

  Seq()
    .seq('Get job details', function() {
      self.getJobDetails(job, this);
    })
    .seq('Start job', function() {
      self.startJob(job);
    })
    .catch(function(err) {
      logger.warn(err);

      if (job.details) 
        self.jobs_.close(job.details, states.jobs.state.CANCELLED, err.toString());

      job.queue_.delete(job);
      self.findJobs();
    })
    ;
}

Spider.prototype.getJobDetails = function(job, callback) {
  var self = this;

  self.jobs_.getDetails(job.body.jobId, function(err, details) {
    job.details = details;
    if (job.details) {
      var state = job.details.state
        , jobState = states.jobs.state
        ;
      if (state != jobState.QUEUED && state != jobState.PAUSED)
        err = new Error('Job does not have a ready state');
    }
    callback(err);
  });
}

Spider.prototype.startJob = function(job) {
  var self = this;
  var jobState = states.jobs.state;

  self.loadSpiderForJob(job, function(err, spider) {
    if (err) {
      logger.warn(util.format('Unable to start job %s: %s', job.id, err));
      self.jobs_.close(job.details, jobState.ERRORED, err);
      job.queue_.delete(job);
      self.findJobs();
      return;
    }

    self.runSpider(spider, job);
  });
}

Spider.prototype.runSpider = function(spider, job) {
  var self = this;

  logger.info('Starting job '  + job.body.jobId);

  self.runningSpiders_.push(spider);

  spider.on('started', self.onSpiderStarted.bind(self, spider, job));
  spider.on('paused', self.onSpiderPaused.bind(self, spider, job));
  spider.on('finished', self.onSpiderFinished.bind(self, spider, job));
  spider.on('error', self.onSpiderError.bind(self, spider, job));
  
  spider.on('link', self.onSpiderLink.bind(self, spider, job));

  self.doSpiderStartWatch(spider, job);
  self.doSpiderTakesTooLongWatch(spider, job);

  try {
    spider.start(job);
  } catch (err) {
    self.onSpiderError(spider, job, err);
  }
}

Spider.prototype.loadSpiderForJob = function(job, callback) {
  var self = this;

  var spiderInfo = self.spiders_.getSpider(job.body.spider);
  if (!spiderInfo) {
    callback(new Error('Unable to find spider'));
    return;
  }

  var spider = null;
  var err = null;
  try {
    spider = self.spiders_.loadSpider(spiderInfo.name);
  } catch(error) {
    err = error;
  }
  callback(err, spider);
}

Spider.prototype.doSpiderStartWatch = function(spider, job) {
  var self = this;
  var err = new Error(util.format('Spider took too long to start: %s', spider.getName()));

  spider.watchId = setTimeout(self.onSpiderError.bind(self, spider, job, err),
                               1000 * 60);
}

Spider.prototype.doSpiderTakesTooLongWatch = function(spider, job) {
  var self = this;

  spider.longId = setInterval(self.isSpiderStalled.bind(self, spider, job),
                               1000 * (config.SPIDER_JOB_TIMEOUT_SECONDS / 2));
}

Spider.prototype.isSpiderStalled = function(spider, job) {
  var self = this;

  function timedOut(err) {
    err = err ? err : new Error('unknown');
    self.onSpiderError(spider, job, err);
  }

  var id = setTimeout(timedOut, 1000 * (config.SPIDER_JOB_TIMEOUT_SECONDS / 4));

  spider.isAlive(function(err) {
    clearTimeout(id);

    if (err) {
      timedOut(err);
    } else {
      job.queue_.touch(job, config.SPIDER_JOB_TIMEOUT_SECONDS);
    }
  });
}

Spider.prototype.onSpiderStarted = function(spider, job) {
  var self = this;

  if (spider.watchId) {
    clearTimeout(spider.watchId);
    spider.watchId = -1;
  }

  self.jobs_.start(job.details, function(err) {
    if (err)
      logger.warn('Unable to make job as started ' + job.body.jobId + ': ' + err);
  });
}

Spider.prototype.onSpiderPaused = function(spider, job, snapshot) {
  var self = this;

  self.jobs_.pause(job.details, state, function(err) {
    if (err)
      logger.warn('Unable to make job as paused ' + job.body.jobId + ': ' + err);
  });
  self.cleanup(spider, job);
  self.findJobs();
}

Spider.prototype.onSpiderFinished = function(spider, job) {
  var self = this;

  self.jobs_.complete(job.details, function(err) {
    if (err)
      logger.warn('Unable to make job as complete ' + job.body.jobId + ': ' + err);
  });
  job.queue_.delete(job);
  self.cleanup(spider, job);
  self.findJobs();
}

Spider.prototype.onSpiderError = function(spider, job, jerr) {
  var self = this;
  jerr = jerr ? jerr : new Error('unknown');

  logger.warn('Spider error: ' + jerr);
  self.jobs_.close(job.details, states.jobs.state.ERRORED, jerr.toString(), function(err) {
    if (err)
      logger.warn('Unable to make job as errored ' + job.body.jobId + ': ' + err);
  });
  job.queue_.delete(job);
  self.cleanup(spider, job);
  self.findJobs();
}

Spider.prototype.onSpiderLink = function(spider, job, link) {
  var self = this;
  self.links_.add(link);
}

Spider.prototype.cleanup = function(spider, job) {
  var self = this;

  clearTimeout(spider.longId);
  clearTimeout(spider.watchId);
  self.runningSpiders_.remove(spider);
}

//
// Overrides
//
Spider.prototype.getName = function() {
  return "spiderRole";
}

Spider.prototype.getDisplayName = function() {
  return "Spider Role";
}

Spider.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.findJobs();

  self.emit('started');
}

Spider.prototype.end = function() {
  var self = this;
  self.emit('ended');
}