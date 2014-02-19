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
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , Storage = acquire('storage')  
  , Verifications = acquire('verifications')
  ;

var PROCESSOR = 'autoverifier';

var AutoVerifier = module.exports = function() {
  this.campaigns_ = null;
  this.storage_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.verifications_ = null;

  this.campaign_ = null;

  this.verifierInstances_ = [];
  this.supportedMimeTypes_ = [];

  this.started_ = 0;
  this.touchId_ = 0;

  Role.call(this);
  this.init();
}

util.inherits(AutoVerifier, Role);

AutoVerifier.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('autoverifier');
  self.verifications_ = new Verifications();
  self.storage_ = new Storage('downloads');
}

AutoVerifier.prototype.loadVerifiers = function(done) {
  var self = this
    , verifiers = {
        'music': ['musicverifier'],
        'music.album': ['musicverifier']
      }
    , supportedVerifiers = verifiers[self.campaign_.type] 
    , verifierInstances = []
    , supportedMimeTypes = []
    , supportedMap = {}
    ;

  supportedVerifiers.forEach(function(verifier) {
    var Klass = require('./' + verifier)
      , instance = new Klass()
      , mimetypes = Klass.getSupportedMimeTypes()
      ;

    verifierInstances.push( { verifier: instance, mimetypes: mimetypes });
    supportedMimeTypes.add(mimetypes);
  });

  self.verifierInstances_ = verifierInstances;
  self.supportedMimeTypes_ = supportedMimeTypes;

  done();
}

AutoVerifier.prototype.finishVerifiers = function() {
  var self = this;

  Object.values(self.verifierInstances_).forEach(function(instanceObj) {
    instanceObj.verifier.finish();
  });
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
      self.loadVerifiers(this);
    })
    .seq(function() {
      self.processVerifications(this);
    })
    .seq(function() {
      logger.info('Finished autoverification session');
      self.finishVerifiers();
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

  if (!self.started_)
    return done();

  if (self.started_.isBefore('30 minutes ago')) {
    logger.info('Been running for long enough, quitting');
    return done();
  }

  self.verifications_.popType(self.campaign_, self.supportedMimeTypes_, PROCESSOR, function(err, infringement) {
    if (err)
      return done(err);

    if (!infringement || !infringement.uri) {
      logger.info('Ran out of infringements to process');
      return done();
    }

    function closeAndGotoNext(err, infringement) {
      logger.warn('Unable to process %s for autoverification: %s', infringement._id, err);
      self.infringements_.processedBy(infringement, PROCESSOR);
      setTimeout(self.processVerifications.bind(self, done), 1000);
      return;
    }

    // We actually have something todo here.
    self.processVerification(infringement, infringement.downloads, function(err) {
      if (err)
        return closeAndGotoNext(err, infringement);

      setTimeout(self.processVerifications.bind(self, done), 1000);
    });
  });
}

AutoVerifier.prototype.processVerification = function(infringement, downloads, done) {
  var self = this
    , verifiers = []
    ;

  // Find some verifiers that fit the bill for this infringement
  var relevantMimetypes = downloads.map(function(download){ return download.mimetype });
  self.verifierInstances_.forEach(function(verifier) {
    if (verifier.mimetypes.intersect(relevantMimetypes)) {
      verifiers.push(verifier.verifier);
    }
  });

  if (!verifiers.length) {
    logger.warn(util.format("Not supported verifiers found for %s", infringement._id));
    return done();
  }

  logger.info('Verifying %s', infringement._id);

  try {
    verifiers[0].verify(self.campaign_, infringement, downloads, function(err, verification) {
      var iStates = states.infringements.state;

      if (err)
        return done(err);

      if (!verification || !verification.state)
        return done(new Error('Invalid verification generated'));

      if (verification.state == iStates.VERIFIED ||
          verification.state == iStates.FALSE_POSITIVE) {
        logger.info('Changing %s to state %s', infringement.uri,
                    verification.state == iStates.VERIFIED ? 'VERIFIED' : 'FALSE_POSITIVE');
        self.infringements_.verify(infringement, verification.state, PROCESSOR, done);

      } else {
        // Just marking as processed so we don't see it again
        self.infringements_.processedBy(infringement, PROCESSOR);
        done();
      }
    });

  } catch (err) {
    done(err);
  }
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
}
