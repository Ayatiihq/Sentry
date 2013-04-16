/*
 * Autoverifier.js: the awesome AutoVerifier
 * (C) 2013 Ayatii Limited
 * AutoVerifier processes infringements that need downloading and attempts to autoverify them depending on the campaign type. 
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('verifier.js')
  , Seq = require('seq')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Settings = acquire('settings')
  ;

var MAX_LINKS = 100;

var AutoVerifier = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.settings_ = null;
  this.jobs_ = null;
  this.started_ = false;
  this.lastTimestamp_ = 0;
  this.init();
}

util.inherits(AutoVerifier, Role);

AutoVerifier.prototype.init = function() {
  var self = this;
  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.settings_ = new Settings('role.autoverifier');
  self.jobs_ = new Jobs('autoverifier');
}

AutoVerifier.prototype.processJob = function(err, job) {
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
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }

  Seq()
    .seq('Job has details', function() {
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq('Job is valid', function(campaign) {
      job.campaign = campaign;
      // We'll need this !
      //self.checkJobValidity(job, this);
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

AutoVerifier.prototype.checkJobValidity = function(job, callback) {
  var self = this;
}

AutoVerifier.prototype.startJob = function(job, done) {
  var self = this;
  console.log('campaign = ' + JSON.stringify(job));  
}

//
// Overrides
//
AutoVerifier.prototype.getName = function() {
  return "autoverifier";
}

AutoVerifier.prototype.start = function(campaign) {
  var self = this;
  self.started_ = true;
  console.log('campaign = ' + JSON.stringify(campaign));  
  self.emit('started');
}

AutoVerifier.prototype.end = function() {
  var self = this;
  self.started_ = false;
  self.emit('ended');
}