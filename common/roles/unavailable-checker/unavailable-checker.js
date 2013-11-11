/*
 * unavailable-checker.js: the unavailable-checker
 *
 * (C) 2012 Ayatii Limited
 *
 * UnavailableChecker checks links to see if they are available. For more
 * details, see https://github.com/afive/sentry/issues/196
 */

var acquire = require('acquire')
  , categories = acquire('states').infringements.category
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , fmt = require('util').format
  , fs = require('fs')
  , logger = acquire('logger').forFile('unavailable-checker.js')
  , os = require('os')
  , path = require('path')
  , states = acquire('states').infringements.state
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  , Unavailable = require('./unavailable')
  ;

var PROCESSOR = 'unavailable-checker'
  , TOO_LONG = 60
  , TIME_SINCE_LAST = '24 hours ago'
  ;

var UnavailableChecker = module.exports = function() {
  this.db_ = null;
  this.collection_ = null;
  
  this.campaigns_ = null;
  this.jobs_ = null;

  this.campaign_ = null;

  this.started_ = 0;
  this.touchId_ = 0;
  this.cachedCalls_ = [];

  this.init();
}

util.inherits(UnavailableChecker, Role);

UnavailableChecker.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection("infringements", function(err, db, coll) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.collection_ = coll;
    
    self.campaigns_ = new Campaigns();
    self.jobs_ = new Jobs('unavailable-checker');
    
    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];

  });
}

UnavailableChecker.prototype.processJob = function(err, job) {
  var self = this;

  if (!self.collection_)
    return self.cachedCalls_.push([self.processJob, Object.values(arguments)]);

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
  }, config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 300);


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
      self.startEngine(job._id.consumer.split('.').last(), this);
    })
    .seq(function() {
      logger.info('Finished unavailable checking (%s)', self.engine_.name);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to process job %j: %s', job, err);
      self.jobs_.close(job, acquire('states').jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

UnavailableChecker.prototype.startEngine = function(engineName, done) {
  var self = this;

  if (!self.collection_)
    return self.cachedCalls_.push([self.startEngine, Object.values(arguments)]);

  logger.info('Running %s for campaign %j', engineName, self.campaign_._id);

  self.loadEngine(engineName, function(err, engine) {
    if (err) return done(err);
    
    self.engine_ = engine;
    self.engine_.run(done);
  });
}

UnavailableChecker.prototype.loadEngine = function(engineName, done) {
  var self = this
    , engines = {
        "unavailable" : UnavailableEngine,
        "nowavailable" : NowAvailableEngine,
        "takendown" : TakenDownEngine
      }
    , Engine = engines[engineName]
    ;

  if (!Engine)
    return done(fmt('No engine called %s', engineName));

  var engine = new Engine(self.campaign_, self.collection_, self.infringements_);
  done(null, engine);  
}


//
// Engines
//
var UnavailableEngine = function(campaign, collection, infringements) {
  var unavailable = new Unavailable();

  return {
    run: function(done) {
      var self = this;

      logger.info('Running the unavailable checking loop');
      self.started_ = Date.create();
      self.loop(done);
    },
    
    loop: function(done) {
      var self = this;

      if (self.started_.isBefore(TOO_LONG + ' minutes ago')) {
        logger.info('Running for too long, taking a nap');
        return done();
      }

      self.getOne(function(err, infringement) {
        if (err) return done(err);
        
        if (!infringement) {
          logger.info('Nothing left to process');
          return done();
        }

        unavailable.check(infringement.uri, function(err, isAvailable) {
          if (err) {
            logger.warn('Unable to check availability of %s: %s', infringement.uri, err);
            return setTimeout(self.loop.bind(self, done), 150);
          }

          var updates = { 
            $set: {
              unavailabled: Date.now()
            }
          };

          if (!isAvailable) {
            updates['$set'].state = states.UNAVAILABLE;
            updates['$set'].verified = Date.now();
          }

          collection.update({ _id: infringement._id }, updates, function(err) {
            if (err)
              logger.warn('Unable to update infringement %s with %s: %s', infringement._id, updates, err);

            return setTimeout(self.loop.bind(self, done), 150);
          });
        });
      });
    },

    getOne: function(done) {

      var then = Date.create('15 minutes ago').getTime()
        , timeSince = Date.create(TIME_SINCE_LAST).getTime()
        , query = {
            campaign: campaign._id,
            popped: { $lt: then },
            state: { $in: [ states.UNVERIFIED, states.NEEDS_DOWNLOAD ] },
            verified: { $exists: false },
            meta: { $exists: false },
            category: { $nin: [categories.SEARCH_RESULT, categories.TORRENT] },
            $or: [
              { unavailabled: { $exists: false } },
              { unavailabled: { $lt: timeSince } }
            ]
          }
        , sort = { 'children.count': -1, created: -1 }
        , updates = { $set: { popped: Date.now() } }
        , options = {
            new: true,
            fields: { _id: 1, uri: 1 }
          }
        ;

      collection.findAndModify(query, sort, updates, options, done);
    }
  }
}


//
// DISABLED FOR NOW
//
var NowAvailableEngine = function(campaign, collection, infringements) {
  return {
    run: function(done) {
      console.log('Hello from NowAvailableEngine');
      done();
    }
  }
}

var TakenDownEngine = function(campaign, collection, infringements) {
  var unavailable = new Unavailable();

  return {
    run: function(done) {
      var self = this;

      logger.info('Running the taken-down checking loop');
      self.started_ = Date.create();
      self.loop(done);
    },
    
    loop: function(done) {
      var self = this;

      if (self.started_.isBefore(TOO_LONG + ' minutes ago')) {
        logger.info('Running for too long, taking a nap');
        return done();
      }

      self.getOne(function(err, infringement) {
        if (err) return done(err);
        
        if (!infringement) {
          logger.info('Nothing left to process');
          return done();
        }

        unavailable.check(infringement.uri, function(err, isAvailable) {
          if (err) {
            logger.warn('Unable to check availability of %s: %s', infringement.uri, err);
            return setTimeout(self.loop.bind(self, done), 150);
          }

          var updates = { 
            $set: {
              unavailabled: Date.now()
            }
          };

          if (!isAvailable) {
            updates['$set'].state = states.TAKEN_DOWN;
          }

          return setTimeout(self.loop.bind(self, done), 150);
          
          collection.update({ _id: infringement._id }, updates, function(err) {
            if (err)
              logger.warn('Unable to update infringement %s with %s: %s', infringement._id, updates, err);

            return setTimeout(self.loop.bind(self, done), 150);
          });
        });
      });
    },

    getOne: function(done) {

      var then = Date.create('15 minutes ago').getTime()
        , timeSince = Date.create(TIME_SINCE_LAST).getTime()
        , query = {
            campaign: campaign._id,
            popped: { $lt: then },
            state: states.SENT_NOTICE,
            meta: { $exists: false },
            category: { $nin: [categories.SEARCH_RESULT, categories.TORRENT] },
            $or: [
              { unavailabled: { $exists: false } },
              { unavailabled: { $lt: timeSince } }
            ]
          }
        , sort = { 'children.count': -1, created: -1 }
        , updates = { $set: { popped: Date.now() } }
        , options = {
            new: true,
            fields: { _id: 1, uri: 1 }
          }
        ;

      collection.findAndModify(query, sort, updates, options, done);
    }
  }
}


//
// Overrides
//
UnavailableChecker.prototype.getName = function() {
  return "unavailable-checker";
}

UnavailableChecker.prototype.start = function() {
  var self = this;

  if (!self.collection_)
    return self.cachedCalls_.push([self.start, Object.values(arguments)]);

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
