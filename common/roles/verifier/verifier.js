/*
 * verifier.js: the verifier
 *
 * (C) 2012 Ayatii Limited
 *
 * Verifier processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
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
  , Verifications = acquire('verifications')
  ;

var MAX_LINKS = 100;

var Verifier = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.settings_ = null;
  this.jobs_ = null;
  this.verifications_ = null;

  this.started_ = false;

  this.lastTimestamp_ = 0;
  this.touchId_ = 0;

  this.timestampIsVerified_ = true;

  this.init();
}

util.inherits(Verifier, Role);

Verifier.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.settings_ = new Settings('role.verifier');
  self.jobs_ = new Jobs('verifier');
  self.verifications_ = new Verifications();
}

Verifier.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.campaigns_.getDetails(job._id.owner, function(err, campaign) {
    if (err) {
      self.emit('error', err);
      return;
    }

    if (job._id.consumer.endsWith('rtl'))
      self.verifyRTL(campaign, job);
    else
      self.verifyLTR(campaign, job);
  });
}

Verifier.prototype.getCampaignKey = function(campaign) {
  return util.format('%s.%s.%s', campaign.name, campaign.created, 'timestamp');
}

Verifier.prototype.verifyRTL = function(campaign, job) {
  var self = this
    , key = self.getCampaignKey(campaign) + ".rtl"
    ;

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, 
  config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  Seq()
    .seq('Get last verify timestamp', function() {
      var that = this;
      
      logger.info('Key %s', key);
      self.settings_.get(key, function(err, value) {
        if (err) console.warn(err);
        
        if (!value)
          value = 0;

        that(null, value);
      });
    })
    .seq('Process all new verifications', function(from) {
      self.lastTimestamp_ = from ? from : 0;
      self.processAllVerifications(campaign, this);
    })
    .seq('Finish up', function(){
      var timestamp = self.lastTimestamp_;
      
      logger.info('Finishing up verification for campaign %j on timestamp %d', campaign._id, timestamp);
      
      self.settings_.set(key, timestamp);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to verify links for %j: %j', campaign._id, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Verifier.prototype.processAllVerifications = function(campaign, done, lastId) {
  var self = this
    , from = self.lastTimestamp_
    ;

  logger.info('Verifying links for %j from timestamp %s', campaign._id, from);

  self.verifications_.getVerifications(campaign, Date.create(from), MAX_LINKS, function(err, endpoints) {
    if (err || endpoints.length == 0 || endpoints.last()._id == lastId)
      return done(err);

    logger.info('Got %d endpoints to process on this round', endpoints.length);
    self.verifyLinks(campaign, endpoints, function(err) {     
      if (err)
        return done(err);

      // Try to get more endpoints to processs
      self.processAllVerifications(campaign, done, endpoints.last()._id);
    });
  });
}

Verifier.prototype.verifyLinks = function(campaign, endpoints, done) {
  var self = this;

  Seq(endpoints)
    .seqEach(function(endpoint) {
      self.dominoEndpoint(campaign, endpoint, this);
    })
    .seq('done', function() {  
      done(null);
    })
    .catch(done)
    ;
}

Verifier.prototype.dominoEndpoint = function(campaign, endpoint, done) {
  var self = this;

  logger.info('%s has %d parents', endpoint._id, endpoint.parents.uris.length);

  Seq(endpoint.parents.uris)
    .seqEach(function(parent) {
      self.updateParentState(campaign, endpoint, parent, this);
    })
    .seq(function() {
      if (self.timestampIsVerified_)
        self.lastTimestamp_ = endpoint.verified;
      else
        self.lastTimestamp_ = endpoint.parents.modified;
      done();
    })
    .catch(done)
    ;
}

Verifier.prototype.updateParentState = function(campaign, endpoint, parentUri, done) {
  var self = this
    , infringement = {}
    ;

  if (parentUri.startsWith('meta')) {
    infringement._id = parentUri.split(':')[1];
  } else {
    infringement._id = self.infringements_.generateKey(campaign, parentUri);
  }
  logger.info('Setting %s to %d for %s', infringement._id, endpoint.state, endpoint._id);
  self.verifications_.verifyParent(infringement, endpoint.state, done);
}

//
// LTR
//

Verifier.prototype.verifyLTR = function(campaign, job) {
  var self = this
    , key = self.getCampaignKey(campaign) + ".ltr"
    ;

  self.timestampIsVerified_ = false;

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, 
  config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  Seq()
    .seq('Get last ltr verify timestamp', function() {
      var that = this;
      
      logger.info('Key %s', key);
      self.settings_.get(key, function(err, value) {
        if (err) console.warn(err);
        
        if (!value)
          value = 0;

        that(null, value);
      });
    })
    .seq('Process all new verifications', function(from) {
      self.lastTimestamp_ = from ? from : 0;
      self.processAllLTRVerifications(campaign, this);
    })
    .seq('Finish up', function(){
      var timestamp = self.lastTimestamp_;
      
      logger.info('Finishing up verification for campaign %j on timestamp %d', campaign._id, timestamp);
      
      self.settings_.set(key, timestamp);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to mine links for %j: %s', campaign._id, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Verifier.prototype.processAllLTRVerifications = function(campaign, done, lastId) {
  var self = this
    , from = self.lastTimestamp_
    ;

  logger.info('Verifying ltr links for %j from timestamp %s', campaign._id, from);

  self.verifications_.getAdoptedEndpoints(campaign, Date.create(from), MAX_LINKS, function(err, endpoints) {
    if (err || endpoints.length == 0 || endpoints.last()._id == lastId)
      return done(err);

    logger.info('Got %d endpoints to process on this round', endpoints.length);
    self.verifyLinks(campaign, endpoints, function(err) {     
      if (err)
        return done(err);

      // Try to get more endpoints to processs
      self.processAllLTRVerifications(campaign, done, endpoints.last()._id);
    });
  });
}


//
// Overrides
//
Verifier.prototype.getName = function() {
  return "verifier";
}

Verifier.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Verifier.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}