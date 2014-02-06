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
  , Role = acquire('role')
  , Spiders = acquire('spiders')
  , Seq = require('seq')
  ;

var Spider = module.exports = function() {
  this.jobs_ = null;
  this.links_ = null;

  this.spiders_ = null;
  this.started_ = false;

  this.runningSpiders_ = [];

  this.init();
}

util.inherits(Spider, Role);

Spider.prototype.init = function() {
  var self = this;

  self.jobs_ = new Jobs('spider');
  self.links_ = new Links();  
  self.spiders_ = new Spiders();
}

Spider.prototype.processJob = function(err, job) {
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

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack, console.trace());
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }

  Seq()
    .seq('Start job', function() {
      self.startJob(job, this);
    })
    .catch(onError)
    ;
  
  process.on('uncaughtException', onError);
}

Spider.prototype.startJob = function(job, done) {
  var self = this;

  self.loadSpiderForJob(job, function(err, spider) {
    if (err)
      done(err);
    else
      self.runSpider(spider, job, done);
  });
}

Spider.prototype.runSpider = function(spider, job, done) {
  var self = this;

  // So we can finish from anywhere
  job.done = done;

  logger.info('Running job %j', job._id);

  self.runningSpiders_.push(spider);

  spider.on('started', self.onSpiderStarted.bind(self, spider, job));
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

  var spiderInfo = self.spiders_.getSpider(job._id.owner);
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
      self.jobs_.touch(job);
    }
  });
}

Spider.prototype.onSpiderStarted = function(spider, job) {
  var self = this;

  if (spider.watchId) {
    clearTimeout(spider.watchId);
    spider.watchId = -1;
  }

  self.jobs_.start(job, function(err) {
    if (err)
      logger.warn('Unable to make job as started %j: %s', job._id, err);
  });
}

Spider.prototype.onSpiderFinished = function(spider, job) {
  var self = this;

  self.jobs_.complete(job, function(err) {
    if (err)
      logger.warn('Unable to make job as complete %j: %s', job._id, err);
  });
  self.cleanup(spider, job);
  job.done();
}

Spider.prototype.onSpiderError = function(spider, job, jerr) {
  var self = this;
  jerr = jerr ? jerr : new Error('unknown');
  jerr = Object.isString(jerr) ? new Error(jerr) : jerr;

  logger.warn('Spider error: %s', jerr);
  logger.warn(jerr.stack);

  self.jobs_.close(job, states.jobs.state.ERRORED, jerr, function(err) {
    if (err)
      logger.warn('Unable to complete job as errored %j: %s', job._id, err);
  });

  self.cleanup(spider, job);
  job.done();
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
  self.jobs_.pop(self.processJob.bind(self));
  self.emit('started');
}

Spider.prototype.end = function() {
  var self = this;
  self.emit('ended');
}
