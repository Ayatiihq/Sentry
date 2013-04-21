/*
 * autoverifier.js: the autoverifier
 *
 * (C) 2012 Ayatii Limited
 *
 * AutoVerifier processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('autoverifier.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  , Verifications = acquire('verifications')
  ;

var AutoVerifier = module.exports = function() {
  this.campaigns_ = null;
  this.jobs_ = null;
  this.verifications_ = null;

  this.campaign_ = null;

  this.started_ = 0;
  this.touchId_ = 0;

  this.init();
}

util.inherits(AutoVerifier, Role);

AutoVerifier.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.jobs_ = new Jobs('autoverifier');
  self.verifications_ = new Verifications();

  self.loadVerifiers();
}

AutoVerifier.prototype.loadVerifiers = function() {
  var self = this
    , supportedTypes = []
    , supportedMap = {}
    , verifiers = ['musicverifier']
    ;

  verifiers.forEach(function(verifier) {
    var klass = require('./' + verifier)
      , types = klass.getSupportedTypes()
      ;

    types.forEach(function(type) {
      supportedTypes.push(type);
      supportedMap[type] = klass;
    });
  });

  self.supportedTypes_ = supportedTypes;
  self.supportedMap_ = supportedMap;
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

  // Now we process jobs
  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.processVerifications(this);
    })
    .seq(function() {
      logger.info('Finished autoverification session');
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

AutoVerifier.prototype.processVerifications = function(done) {
  var self = this;

  if (self.started_.isBefore('60 minutes ago')) {
    logger.info('Been running for around an hour, quitting');
    done();
  }

  self.verifications_.popType(self.campaign_, self.supportedTypes_, function(err, infringement) {
    if (err)
      return done(err);

    if (!infringement || !infringement.uri)
      return done();

    self.processVerification(infringement, function(err) {
      if (err) {
        logger.warn(err);
        // FIXME: Should we set something on the infringement so we don't see it again?
      }

      self.processVerifications(done);
    });
  });
}

AutoVerifier.prototype.processVerification = function(infringement, done) {
  var self = this
    , Verifier = self.supportedMap_[infringement.metadata.mimetype]
    ;

  if (!Verifier) {
    var err = util.format('Mimetype %s is not supported for infringement %s',
                           infringement.metadata.mimetype, infringement._id);
    return done(new Error(err));
  }

  logger.info('Verifying %s', infringement.uri);

  var verifier = new Verifier();
  verifier.verify(self.campaign_, infringement, function(err, verification) {
    if (err)
      return done(err);

    if (!verification || !verification.state)
      return done(new Error('Invalid verification generated'));

    // FIXME: Record the verification in the db
    logger.info('%s verified: %j', infringement._id, verification);
    done();
  });
}

//
// Overrides
//
AutoVerifier.prototype.getName = function() {
  return "autoverifier";
}

AutoVerifier.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

AutoVerifier.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}