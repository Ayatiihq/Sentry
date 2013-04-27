  /*
 * processor.js: the processor
 *
 * (C) 2012 Ayatii Limited
 *
 * Processor runs processor jobs on the database.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('processor.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  ;

var requiredCollections = ['campaigns', 'infringements', 'hosts'];

var Processor = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;

  this.job_ = null;
  this.campaign_ = null;
  this.collections_ = [];

  this.started_ = false;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Processor, Role);

Processor.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('processor');
}

Processor.prototype.processJob = function(err, job) {
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

  Seq(requiredCollections)
    .seqEach(function(collectionName) {
      var that = this;

      database.connectAndEnsureCollection(collectionName, function(err, db, collection) {
        if (err)
          return that(err);

        self.db_ = db;
        self.collections_[collectionName] = collection;
        that();
      });
    })
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.run(this);
    })
    .seq(function() {
      logger.info('Finished running processor');
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

Processor.prototype.run = function(done) {
  done();
}

//
// Overrides
//
Processor.prototype.getName = function() {
  return "processor";
}

Processor.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Processor.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}