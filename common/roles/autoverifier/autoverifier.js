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
  , Downloads = acquire('downloads')
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , Verifications = acquire('verifications')
  ;

var PROCESSOR = 'autoverifier';

var AutoVerifier = module.exports = function() {
  this.campaigns_ = null;
  this.downloads_ = null;
  this.infringements_ = null;
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
  self.downloads_ = new Downloads();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('autoverifier');
  self.verifications_ = new Verifications();

  self.loadVerifiers();
}

AutoVerifier.prototype.loadVerifiers = function() {
  var self = this
    , supportedMimeTypes = []
    , supportedMap = {}
    , supportedCampaignTypes = []
    ;
  // Static list of what verifiers we support
  // Note the verifierType should correspond to one of the predefined campaign types in campaigns.js 
  // {verifierType: filename}
  var verifiers = {
    'music': 'musicverifier',
    'music.album': 'musicverifier'
  };
    
  Object.keys(verifiers).forEach(function(verifierType) {
    var klass = require('./' + verifiers[verifierType])
      , instance = new klass()
      , mimeTypes = klass.getSupportedMimeTypes()
      ;

    supportedMap[verifierType] = instance;
    
    // what's this for (source)?
    instance.source = verifierType;
    
    mimeTypes.forEach(function(type) {
      supportedMimeTypes.push(type);
    });
  });

  self.supportedMimeTypes_ = supportedMimeTypes;
  self.supportedMap_ = supportedMap;
  self.supportedCampaignTypes_ = supportedCampaignTypes;
}

AutoVerifier.prototype.finishVerifiers = function() {
  var self = this;

  Object.values(self.supportedMap).forEach(function(verifier) {
    verifier.finish();
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

  if (self.started_.isBefore('20 minutes ago')) {
    logger.info('Been running for long enough, quitting');
    done();
  }

  self.verifications_.popType(self.campaign_, self.supportedMimeTypes_, PROCESSOR, function(err, infringement) {
    if (err)
      return done(err);

    if (!infringement || !infringement.uri) {
      logger.info('No work to do');
      return done();
    }

    Seq()
      .seq(function() {
        self.downloads_.getInfringementDownloads(infringement, this);
      })
      .seq(function(downloads) {
        self.processVerification(infringement, downloads, this);
      })
      .seq(function() {
        setTimeout(self.processVerifications.bind(self, done), 100);
        this();
      })
      .catch(function(err) {
        logger.warn(err);
        self.infringements_.processedBy(infringement, PROCESSOR);
        setTimeout(self.processVerifications.bind(self, done), 100);
      })
      ;
  });
}

AutoVerifier.prototype.processVerification = function(infringement, downloads, done) {
  var self = this;

  if(self.supportedCampaignTypes_.some(infringement.campaign.type)){
    logger.info('Infringement has found a valid autoverifier');
    
    if(infringement.mimetypes.intersect(self.supportedMimeTypes_).length === 0)
      logger.warn("Nope we don't support any of those mimetypes");
    else
      var verifier = self.supportedMap_[infringement.campaign.type]; 
  }

  if (!verifier) {
    logger.warn(util.format("Either campaign type is not supported or one of the mimetypes for infringement %s",
                           infringement._id));
    return done();
  }

  logger.info('Verifying %s', infringement.uri);

  try {

    verifier.verify(self.campaign_, infringement, downloads, function(err, verification) {
      var iStates = states.infringements.state;

      if (err)
        return done(err);

      if (!verification || !verification.state)
        return done(new Error('Invalid verification generated'));

      if (verification.state == iStates.VERIFIED ||
          verification.state == iStates.FALSE_POSITIVE) {
        logger.info('Verifying to state %s',
                     verification.state == iStates.VERIFIED ? 'VERIFIED' : 'FALSE_POSITIVE');
        return self.verifications_.submit(infringement, verification, done);

      } else {
        // Just marking as processed so we don't see it again
        self.infringements_.processedBy(infringement, PROCESSOR);
      }

      done();
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

  self.emit('ended');
}