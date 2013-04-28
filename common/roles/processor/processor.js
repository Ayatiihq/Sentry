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
  , fs = require('fs')
  , logger = acquire('logger').forFile('processor.js')
  , os = require('os')
  , path = require('path')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , URI = require('URIjs')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Downloads = acquire('downloads')
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

var requiredCollections = ['campaigns', 'infringements', 'hosts']
  , MAX_LENGTH = 1e9 // ~953MB
  , TMPDIR = 'processor'
  ;

var Processor = module.exports = function() {
  this.campaigns_ = null;
  this.downloads_ = null;
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
  self.downloads_ = new Downloads();
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
    .par(function() {
      self.run(this);
    })
    .par(function() {
      self.run(this);
    })
    .par(function() {
      self.run(this);
    })
    .par(function() {
      self.run(this);
    })
    .seq(function() {
       rimraf(path.join(os.tmpDir(), TMPDIR), this.ok);
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
      rimraf(path.join(os.tmpDir(), TMPDIR), this.ok);
    })
    .seq(function() {
      fs.mkdir(path.join(os.tmpDir(), TMPDIR), this);
    })
    .seq(function() {
      done();  
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Processor.prototype.run = function(done) {
  var self = this
    , infringement = null
    , mimetype = null
    ;

  Seq()
    .seq(function() {
      self.getUnprocessedInfringement(this);
    })
    .seq(function(infringement_) {
      infringement = infringement_;

      if (!infringement) {
        logger.info('No more jobs to process');
        return done();
      }
      logger.info('Processing %s', infringement._id);
      self.categorizeInfringement(infringement, this);
    })
    .seq(function() {
      self.downloadInfringement(infringement, this);
    })
    .seq(function(mimetype_) {
      mimetype = mimetype_;
      self.reCategorizeInfringement(infringement, mimetype, this);
    })
    .seq(function() {
      self.updateInfringementState(infringement, mimetype, this);
    })
    .seq(function() {
      console.log('%s (%s) category=%s state=%s', mimetype, infringement._id, infringement.category, infringement.state);
      self.updateInfringement(infringement, this);
    })
    .seq(function() {
      setTimeout(self.run.bind(self), 50);
    })
    .catch(function(err) {
      logger.warn(err);
      setTimeout(self.run.bind(self), 50);
    })
    ;
}

Processor.prototype.getUnprocessedInfringement = function(done) {
  var self = this
    , infringements = self.collections_['infringements']
    , query = {
        processed: {
          $exists: false
        },
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

  logger.info('Putting infringement into initial category of %d', infringement.category);

  done(null);
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
  var self = this
    , outName = self.downloads_.generateName(infringement, 'initialDownload')
    , outPath = path.join(os.tmpDir(), TMPDIR, outName)
    , started = 0
    , finished = 0
    , mimetype = 'text/html'
    ;

  // We let something else deal with these for now
  if ([Categories.SEARCH_RESULT, Categories.CYBERLOCKER, Categories.TORRENT].some(infringement.category))
    return done(null, mimetype);

  logger.info('Downloading %s to %s', infringement.uri, outPath);
  var outStream = fs.createWriteStream(outPath);

  Seq()
    .seq(function() {
      utilities.requestStream(infringement.uri, {}, this);
      started = Date.now();
    })
    .seq(function(req, res, stream) {
      var totalSize = 0;
      stream.on('data', function(chunk) {
        totalSize += chunk.length;
        if (totalSize > MAX_LENGTH) {
          logger.warn('Download is too large (max: ' + MAX_LENGTH + '): ' + infringement.uri);
          req.abort();
          done(null, mimetype);
        }
      });

      stream.pipe(outStream);
      stream.on('end', this);
      stream.on('error', this);
    })
    .seq(function() {
      logger.info('Download finished for %s', outPath);
      finished = Date.now();
      self.downloads_.getFileMimeType(outPath, this);
    })
    .seq(function(mimetype_) {
      mimetype = mimetype_;
      self.downloads_.addLocalFile(infringement, outPath, started, finished, this);
    })
    .seq(function() {
      rimraf(outPath, function(err) { if (err) logger.warn(err); });
      done(null, mimetype);
    })
    .catch(function(err) {
      logger.warn('Problem downloading: %s: %s', infringement.uri, err);

      if (err.statusCode >= 400)
        infringement.state = State.UNAVAILABLE;
      
      done(null, mimetype);
    })
    ;
}

Processor.prototype.reCategorizeInfringement = function(infringement, mimetype, done) {
  var self = this
    , mimetype = mimetype ? mimetype : ''
    , first = mimetype.split('/')[0]
    , last = mimetype.split('/')[1]
    ;

  first = first ? first : '';
  last = last ? last : '';

  if ([Categories.SEARCH_RESULT, Categories.CYBERLOCKER, Categories.TORRENT].some(infringement.category)) {
    ;
  
  } else if (first == 'text' || last.has('xml') || last.has('html') || last.has('script')) {
    if (![Categories.WEBSITE, Categories.SOCIAL].some(infringement.category))
      infringement.category = Categories.WEBSITE;          
  
  } else if (last.has('torrent')) {
    infringement.category = Categories.TORRENT;

  } else {
    infringement.category = Categories.FILE;
  }

  logger.info('Recategorising infringement to category %d', infringement.category);

  done();
}

Processor.prototype.updateInfringementState = function(infringement, mimetype, done) {
  var self = this;

  logger.info('Updating infringement state');

  if (infringement.verified || infringement.state == State.UNVERIFIED)
    return done();

  switch (infringement.category) {
    case Categories.CYBERLOCKER:
    case Categories.TORRENT:
      infringement.state = State.NEEDS_DOWNLOAD;
      break;

    case Categories.SEARCH_RESULT:
    case Categories.WEBSITE:
    case Categories.SOCIAL:
      infringement.state = infringement.children.count ? State.UNVERIFIED : State.NEEDS_SCRAPE;
      break;

    case Categories.FILE:
      infringement.state = State.UNVERIFIED;
      break;

    default:
      logger.warn('Category state %d is unknown', infringement.category);
      return done('Unknown category ' + infringement.category);
  }

  done();
}

Processor.prototype.updateInfringement = function(infringement, done) {
  var self = this
    , collection = self.collections_['infringements']
    , query = {
        _id: infringement._id
      }
    , updates = {
        $set: {
          category: infringement.category,
          state: infringement.state,
          processed: Date.now()
        }
      }
    ;

  if (infringement.verified)
    updates.$set = Object.reject(updates.$set, 'state');

  logger.info('Updating infringement with %d changes', Object.keys(updates.$set).length);

  collection.update(query, updates, done);
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