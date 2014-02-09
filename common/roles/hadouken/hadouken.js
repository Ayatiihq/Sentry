/*
 * hadouken.js: the Hadouken feeder
 *
 * (C) 2014 Ayatii Limited
 *
 * Identifies recently verified torrents for a given campaign and hands them to hadouken
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fmt = require('util').format
  , logger = acquire('logger').forFile('hadouken.js')
  , states = acquire('states')
  , util = require('util')  
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  ;

var PROCESSOR = 'hadouken';

var Hadouken = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;

  this.campaign_ = null;

  this.started_ = 0;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Hadouken, Role);

Hadouken.prototype.init = function() {
  var self = this;
  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('hadouken');
}

Hadouken.prototype.processJob = function(err, job) {
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
    logger.warn(err.stack, console.trace());
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
    })
    .seq(function() {
      self.findTorrentsToMonitor(this);
    })
    .seq(function(ourPrey) {
      self.goMonitor(ourPrey);
    })
    .seq(function(){
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

Hadouken.prototype.findTorrentsToMonitor = function(done){
  var self = this;
  var magnets = [];

  Seq()
    .seq(function(){
      self.infringements_.find({campaign: self.campaign._id,
                                scheme: 'torrent',
                                'children.count': 0,
                                state: { $in: [1, 3, 4 ]}});
    })
    .seq(function(results){
      results.each(function(result){
        var potentials = result.parents.uris.filter(function())
        magnets.push(result.parents)
      });
    })
    .catch(function(err){
      done(err);
    })
}
//
// Overrides
//
Hadouken.prototype.getName = function() {
  return "hadouken";
}

Hadouken.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Hadouken.prototype.end = function() {
  var self = this;

  self.started_ = false;
}
