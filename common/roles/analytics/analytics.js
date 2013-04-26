  /*
 * analytics.js: the analytics
 *
 * (C) 2012 Ayatii Limited
 *
 * Analytics runs analytics jobs on the database.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('analytics.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Seq = require('seq')
  ;

var HostsInfo = require('./hostsinfo')
  , HostsMR = require('./hostsmr')
  ;

var Analytics = module.exports = function() {
  this.campaigns_ = null;
  this.jobs_ = null;
  this.settings_ = null;

  this.job_ = null;
  this.campaign_ = null;
  this.collections_ = [];


  this.started_ = false;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Analytics, Role);

Analytics.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.jobs_ = new Jobs('analytics');
  self.settings_ = new Settings('role.analytics');
}

Analytics.prototype.processJob = function(err, job) {
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

  var requiredCollections = ['campaigns', 'infringements', 'hosts', 'hostBasicStats', 'hostLocationStats'];

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
      self.runAnalytics(this);
    })
    .seq(function() {
      logger.info('Finished running analytics');
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

Analytics.prototype.runAnalytics = function(done) {
  var self = this;

  Seq(self.loadWork())
    .seqEach(function(work) {
      var that = this;

      work(self.db_,
           self.collections_,
           self.campaign_, 
           function(err) {
        if (err)
          logger.warn(err);

        that();
      });
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Analytics.prototype.loadWork = function() {
  var self = this
    , work = []
    ;

  work.push(HostsInfo.serverInfo);
  work.push(HostsInfo.websiteInfo);
  work.push(HostsMR.hostBasicStats);
  work.push(HostsMR.hostLocationStats);

  return work;
}

//
// Overrides
//
Analytics.prototype.getName = function() {
  return "analytics";
}

Analytics.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Analytics.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}