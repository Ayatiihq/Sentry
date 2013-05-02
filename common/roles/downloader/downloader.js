/*
 * downloader.js: the downloader
 *
 * (C) 2012 Ayatii Limited
 *
 * Downloader role looks for infringements that need downloading, and downloads them.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('downloader.js')
  , Seq = require('seq')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  ;

var Downloader = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;

  this.started_ = false;

  this.touchId_ = 0;

  this.init();
}

util.inherits(Downloader, Role);

Downloader.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('downloader');
}

Downloader.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  Seq()
    .seq(function() {
      self.preRun(this);
    })
    .seq(function() {
      self.run(this);
    })
    .seq(function() {
      logger.info('Finished running downloader');
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to download job %j: %s', job, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Downloader.prototype.preRun = function(job, done) {
  var self = this;

  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Downloader.prototype.run = function(done) {
  var self = this;

  console.log('Hello %j', self.campaign_);
}

//
// Overrides
//
Downloader.prototype.getName = function() {
  return "downloader";
}

Downloader.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Downloader.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}

if (process.argv[1].endsWith('downloader.js')) {
  var downloader = new Downloader();

   Seq()
    .seq(function() {
      downloader.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      downloader.run(this);
    })
    .seq(function() {
      logger.info('Finished running Processor');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}