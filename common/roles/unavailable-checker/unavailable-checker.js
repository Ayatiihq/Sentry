/*
 * unavailable-checker.js: the unavailable-checker
 *
 * (C) 2012 Ayatii Limited
 *
 * UnavailableChecker checks links to see if they are available. For more
 * details, see https://github.com/afive/sentry/issues/196
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fmt = require('util').format
  , fs = require('fs')
  , logger = acquire('logger').forFile('unavailable-checker.js')
  , os = require('os')
  , path = require('path')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , Verifications = acquire('verifications')
  ;

var PROCESSOR = 'unavailable-checker';

var UnavailableChecker = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.verifications_ = null;

  this.campaign_ = null;

  this.started_ = 0;
  this.touchId_ = 0;

  this.init();
}

util.inherits(UnavailableChecker, Role);

UnavailableChecker.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('unavailable-checker');
  self.verifications_ = new Verifications();
}

UnavailableChecker.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  // Keep job alive
  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);


  // Error out nicely, closing the job too
  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);

  // Now we process jobs
  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.startEngine(job.metadata.engine, this);
    })
    .seq(function() {
      logger.info('Finished unavailable checking (%s)', self.engine_.name);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to process job %j: %s', job, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

UnavailableChecker.prototype.startEngine = function(engineName, done) {
  var self = this;

  self.loadEngine(engineName, function(err, engine) {
    if (err) return done(err);
    
    self.engine_ = engine;
    self.engine_.run(done);
  });
}

UnavailableChecker.prototype.loadEngine = function(engineName, done) {
  var self = this,
    , engines = {
        "unavailable" : UnavailableEngine,
        "nowavailable" : NowAvailableEngine,
        "takendown" : TakenDownEngine
      }
    , engine = 
    ;
}

//
// Overrides
//
UnavailableChecker.prototype.getName = function() {
  return "unavailable-checker";
}

UnavailableChecker.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

UnavailableChecker.prototype.end = function() {
  var self = this;

  self.started_ = false;
}


// Testing
if (require.main == module) {
  var campaign = require(process.argv[2])
    , engineName = process.argv[3]
    , checker = new UnavailableChecker()
    ;

  checker.campaign_ = campaign;
  checker.startEngine(engineName, function(err) {
    if (err) console.log(err);
    process.exit();
  });
}
