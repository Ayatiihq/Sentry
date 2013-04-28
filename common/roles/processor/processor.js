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
  , URI = require('URIjs')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  ;

var Categories = states.infringements.category
  , Cyberlockers = acquire('cyberlockers').knownDomains
  , SocialNetworks = ['facebook.com', 'twitter.com', 'plus.google.com', 'myspace.com', 'orkut.com', 'badoo.com', 'bebo.com']
  , State = states.infringements.state
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

  Seq()
    .seq(function() {
      self.preRun(job, this);
    })
    .seq(function() {
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

Processor.prototype.preRun = function(job, done) {
  var self = this;

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
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Processor.prototype.run = function(done) {
  var self = this;

  Seq()
    .seq(function() {
      self.getUnprocessedInfringement(this);
    })
    .seq(function(infringement) {
      if (!infringement) {
        logger.info('No more jobs to process');
        return done();
      }

      self.categorizeInfringement(infringement, this);
    })
    .seq(function(infringement) {
      self.downloadInfringement(infringement, this);
    })
    .seq(function(infringement) {
      this();
    })
    .seq(function(infringement) {
      console.log(infringement);
      done();
    })
    .catch(function(err) {
      logger.warn(err);
      setTimeout(self.run.bind(self), 1000);
    })
    ;
}

Processor.prototype.getUnprocessedInfringement = function(done) {
  var self = this
    , infringements = self.collections_['infringements']
    , query = {
        state: states.infringements.state.NEEDS_PROCESSING,
        created: {
          $lt: Date.create('2 minutes ago').getTime()
        },
        $or: [
          {
            popped: {
              $lt: Date.create('15 minutes ago').getTime()
            }
          },
          {
            popped: {
              $exists: false
            }
          }
        ]
      }
    , sort = [
        ['created', 1]
      ]
    , updates = {
        $set: {
          popped: Date.now()
        }
      }
    , options = {
        new: true
      }
    ;

  infringements.findAndModify(query, sort, updates, options, done);
}

Processor.prototype.categorizeInfringement = function(infringement, done) {
  var self = this
    , hostname = utilities.getHostname(infringement.uri)
    , meta = infringement.meta
    , uri = infringement.uri
    , scheme = infringement.scheme
    ;

  if (meta) {
    infringement.category = Categories.SEARCH_RESULT
  
  } else if (scheme == 'torrent' || scheme == 'magnet') {
    infringement.category = Categories.TORRENT;
  
  } else if (self.isCyberlocker(uri, hostname)) {
    infringement.category = Categories.CYBERLOCKER;
  
  } else if (self.isSocialNetwork(uri, hostname)) {
    infringement.category = Categories.SOCIAL;
  
  } else {
    infringement.category = Categories.WEBSITE;
  }

  done(null, infringement);
}

Processor.prototype.isCyberlocker = function(uri, hostname) {
  var ret = false;

  Cyberlockers.forEach(function(domain) {
    ret = ret || hostname.endsWith(domain);
  });

  return ret;
}

Processor.prototype.isSocialNetwork = function(uri, hostname) {
  var ret = false;

  SocialNetworks.forEach(function(domain) {
    ret = ret || hostname.endsWith(domain);
  });

  return ret;
}

Processor.prototype.downloadInfringement = function(infringement, done) {
  var self;

  // We let something else deal with these for now
  if (infringement.category == Categories.CYBERLOCKER ||
    infringement.category == Categories.TORRENT) {
    return this();
  }

  
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

if (process.argv[1].endsWith('processor.js')) {
  var processer = new Processor();
 
  Seq()
    .seq(function() {
      processer.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      processer.run(this);
    })
    .seq(function() {
      logger.info('Finished running Processor');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}