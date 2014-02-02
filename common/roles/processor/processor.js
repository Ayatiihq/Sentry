  /*
 * processor.js: the processor
 *
 * (C) 2012 Ayatii Limited
 *
 * Processor runs on every new link produced in the db, categorising it, adding a state
 * downloading it and some other bits-and-bobs.
 *
 */
require('sugar')
var acquire = require('acquire')
  , blacklist = acquire('blacklist')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , fs = require('fs')
  , isBinaryFile = require("isbinaryfile")
  , logger = acquire('logger').forFile('processor.js')
  , os = require('os')
  , path = require('path')
  , readTorrent = require('read-torrent')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , URI = require('URIjs')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  , Storage = acquire('storage')  
  , Verifications = acquire('verifications')
  ;

var Categories = states.infringements.category
  , Extensions = acquire('wrangler-rules').typeExtensions
  , SocialNetworks = ['facebook.com', 'twitter.com', 'plus.google.com', 'myspace.com', 'orkut.com', 'badoo.com', 'bebo.com']
  , State = states.infringements.state
  ;

var requiredCollections = ['campaigns', 'infringements', 'hosts']
  , MAX_LENGTH = 1e9 // ~953MB
  , TMPDIR = 'processor'
  ;

var STORAGE_NAME = 'downloads';

var Processor = module.exports = function() {
  this.campaigns_ = null;

  this.hosts_ = null;
  this.infringements_ = null;

  this.jobs_ = null;

  this.job_ = null;
  this.campaign_ = null;
  this.collections_ = [];
  this.verifications_ = null
  this.storage_ = null;
  this.started_ = false;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Processor, Role);

Processor.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.hosts_ = new Hosts();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('processor');
  self.verifications_ = new Verifications();
  self.storage_ = new Storage(STORAGE_NAME);
  self.on('error', self.stopBeat.bind(self));
  self.on('finished', self.stopBeat.bind(self));
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
    logger.warn('Unable to process job: %s %s', err);
    logger.warn(err.stack);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);

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
    .seq(function() {
       rimraf(self.tmpdir_, this.ok);
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
      self.startBeat(self.campaigns_, campaign);
      self.tmpdir_ = path.join(os.tmpDir(), 'processor-' + campaign._id);
      rimraf(self.tmpdir_, this.ok);
    })
    .seq(function() {
      fs.mkdir(self.tmpdir_, this);
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

  if (!self.started_)
    return done();

  if (Date.create(self.started_).isBefore('30 minutes ago')) {
    logger.info('Running for too long');
    return done();
  }

  Seq()
    .seq(function() {
      self.getUnprocessedInfringement(this);
    })
    .seq(function(infringement_) {
      infringement = infringement_;

      if (!infringement) {
        logger.info('No more infringements to process');
        return done();
      }
      logger.info('Processing %s', infringement._id);
      infringement.errors = [];
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
      self.checkIfExtensionLedToWebpage(infringement, mimetype, this);
    })
    .seq(function() {
      self.updateInfringementState(infringement, mimetype, this);
    })
    .catch(function(err) {
      logger.warn('Error processing %s: %s', infringement._id, err);
      infringement.state = State.UNVERIFIED;
      infringement.category = Categories.WEBSITE;
      infringement.errors.push(err);
    })
    .seq(function() {
      logger.info('%s (%s) category=%s state=%s', mimetype, infringement._id, infringement.category, infringement.state);
      self.updateInfringement(infringement, this);
    })
    .seq(function() {
      self.addInfringementRelations(infringement, mimetype, this);
    })
    .seq(function() {
      self.checkBlacklisted(infringement, mimetype, this);
    })
    .seq(function() {
      self.checkIfDomain(infringement, mimetype, this);
    })
    .seq(function() {
      self.verifyUnavailable(infringement, mimetype, this);
    })
    .seq(function() {
      self.reducePointsForCommonFalsePositives(infringement, mimetype, this);
    })
    .seq(function() {
      setTimeout(self.run.bind(self, done), 100);
      this();
    })
    ;
}

Processor.prototype.getUnprocessedInfringement = function(done) {
  var self = this
    , infringements = self.collections_['infringements']
    , query = {
        campaign: self.campaign_._id,
        processed: {
          $exists: false
        },
        verified: {
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
    , domain = utilities.getDomain(infringement.uri)
    , hostname = utilities.getHostname(infringement.uri)
    , meta = infringement.meta
    , uri = infringement.uri
    , scheme = infringement.scheme
    ;

  self.isCyberlockerOrTorrent(uri, domain, infringement, function(err, result){
    if(err)
      return done(err);

    if(result.success){
      infringement.category = result.category;
    } 
    else if (meta) {
      infringement.category = Categories.SEARCH_RESULT
    
    } else if (scheme == 'torrent' || scheme == 'magnet') {
      infringement.category = Categories.TORRENT;
    
    } else if (self.isSocialNetwork(uri, hostname)) {
      infringement.category = Categories.SOCIAL;
    
    } else {
      infringement.category = Categories.WEBSITE;
    }    

    logger.info('Putting infringement into initial category of %d', infringement.category);

    done(null);

  });

}

Processor.prototype.isTorrentSite = function(uri, hostname, infringement, done) {
  var self = this
    , category = states.infringements.category.TORRENT
  ;

  self.hosts_.getDomainsByCategory(category, function(err, domains){
    if(err)
      return done(err)
    done(null, domains.indexOf(hostname) >= 0);
  });
}

Processor.prototype.isCyberlockerOrTorrent = function(uri, hostname, infringement, done) {
  var self = this
    , result = {success: false, category: ''}
  ;
  self.isTorrentSite(uri, hostname, infringement, function(err, isTorrent){
    if(err)
      return done(err);

    if(isTorrent){
      result.success = true;
      result.category = states.infringements.category.TORRENT;
      return done(null, result);
    }

    self.hosts_.getDomainsByCategory(states.infringements.category.CYBERLOCKER, function(err, domains){
      if(err)
        return done(err)
      var isCl = domains.indexOf(hostname) >= 0;
      if(isCl){
        result.success = true;
        result.category = , category = states.infringements.category.CYBERLOCKER;

        return done(null, result);        
      } 
      done(null, result);
    });   
  });
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
    , outName = utilities.genLinkKey(infringement._id, Date.now())
    , outPath = path.join(self.tmpdir_, outName)
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
    .seq(function(){
      logger.info('Download finished for %s', outPath);
      utilities.getFileMimeType(outPath, this);
    })
    .seq(function(mimetype_) {
      mimetype = mimetype_;
      isBinaryFile(outPath, this);
    })
    .seq(function(isBinary) {
      if(isBinary){
        //md5s are generated in storage, if the file exists already it will return immediately.
        self.storage.addLocalFile(infringement.campaign, outPath, this);
      }
      else{
        this();
      }
    })
    .seq(function() {
      rimraf(outPath, function(err) { if (err) logger.warn(err); });
      done(null, mimetype);
    })
    .catch(function(err) {
      logger.warn('Problem downloading: %s: %s', infringement.uri, err);

      if (err.statusCode >= 400)
        infringement.state = State.UNAVAILABLE;
      else {
        infringement.errors.push(err);
      }
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

  logger.info('Recategorising %s to category %d', infringement._id, infringement.category);

  done();
}

Processor.prototype.updateInfringementState = function(infringement, mimetype, done) {
  var self = this;

  logger.info('Updating %s state', infringement._id);

  if (infringement.verified || infringement.state == State.UNAVAILABLE)
    return done();

  switch (infringement.category) {
    case Categories.CYBERLOCKER:
      infringement.state = State.NEEDS_DOWNLOAD;
      break;

    case Categories.TORRENT:
      // We only want to download the endpoint for torrents, which is the torrent://$infohash
      infringement.state = infringement.scheme == 'torrent' ? State.NEEDS_DOWNLOAD : State.UNVERIFIED;
      break;

    case Categories.SEARCH_RESULT:
    case Categories.WEBSITE:
    case Categories.SOCIAL:
      infringement.state = infringement.children.count ? State.UNVERIFIED : State.NEEDS_SCRAPE;
      if (infringement.source == 'generic') {
        infringement.state = State.UNVERIFIED;
      }
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

  if (infringement.errors.length) {
    var errs = [];
    infringement.errors.forEach(function(error) {
      if (error.stack)
        errs.push(error.stack.toString());
      else
        errs.push(error.toString());
    });
    updates.$set['errors'] = errs;
  }

  logger.info('Updating %s with %d changes', infringement._id, Object.keys(updates.$set).length);

  collection.update(query, updates, done);
}

Processor.prototype.checkBlacklisted = function(infringement, mimetype, done) {
  var self = this
    , blacklisted = false
    ;

  if (infringement.category == Categories.CYBERLOCKER || infringement.verified)
    return done();

  blacklist.safeDomains.forEach(function(domain) {
    if (infringement.uri.has(domain)) {
      blacklisted = true;
    }
  });

  if (blacklisted) {
    self.infringements_.setStateBy(infringement, State.FALSE_POSITIVE, 'processor', function(err){
      if (err)
        logger.warn('Error setting %s to FALSE_POSITIVE: %s', infringement.uri, err);
      done();
    });
  } else {
    done();
  }
}

Processor.prototype.checkIfDomain = function(infringement, mimetype, done) {
  var self = this
    , isDomain = false
    ;

  if (infringement.scheme == 'torrent' || infringement.scheme == 'magnet' || infringement.verified)
    return done();

  isDomain = !utilities.uriHasPath(infringement.uri);

  if (isDomain) {
    self.infringements_.setStateBy(infringement, State.FALSE_POSITIVE, 'processor', function(err){
      if (err)
        logger.warn('Error setting %s to FALSE_POSITIVE: %s', infringement.uri, err);
      done();
    });
  } else {
    done();
  }
}

Processor.prototype.verifyUnavailable = function(infringement, mimetype, done) {
  var self = this;

  if (infringement.verified || infringement.state != State.UNAVAILABLE)
    return done();

  self.infringements_.setStateBy(infringement, State.UNAVAILABLE, 'processor', function(err){
    if (err)
      logger.warn('Error setting %s to UNAVAILABLE: %s', infringement.uri, err);
    done();
  });

}

Processor.prototype.checkIfExtensionLedToWebpage = function(infringement, mimetype, done) {
  var self = this
    , hadExtension = false
    , extension = ''
    ;

  if (!Extensions[infringement.type])
    return done();

  Extensions[infringement.type].forEach(function(ext) {
    if (infringement.uri.endsWith(ext)) {
      hadExtension = true;
      extension = ext;
    }
  });

  if (!hadExtension)
    return done();

  if (mimetype.has('text/') && mimetype.has('xml') || mimetype.has('html') || mimetype.has('script')) {
    infringement.state = State.UNAVAILABLE;
  }

  done();
}

//
// Some types of file are special and therefore we want to add any useful relations
// i.e. torrent files all point to torrent://$INFO_HASH
//
Processor.prototype.addInfringementRelations = function(infringement, mimetype, done) {
  var self = this;

  // Check for new torrent files
  if (mimetype.has('torrent') && infringement.scheme != 'torrent' && infringement.scheme != 'magnet') {
    self.addTorrentRelation(infringement, done);

  } else if (infringement.scheme == 'magnet') {
    self.addMagnetRelation(infringement, done);

  } else {
    done();
  }
}

Processor.prototype.addTorrentRelation = function(infringement, done) {
  var self = this
    , tmpFile = path.join(os.tmpDir(), infringement._id + '.download.torrent')
    , torrentURI = null
    ;

  Seq()
    .seq(function() {
      utilities.requestStream(infringement.uri, this);
    })
    .seq(function(req, res, stream) {
      stream.pipe(fs.createWriteStream(tmpFile));
      stream.on('end', this);
      stream.on('error', this);
    })
    .seq(function() {
      readTorrent(tmpFile, this);
    })
    .seq(function(torrent) {
      torrentURI = 'torrent://' + torrent.infoHash;
      logger.info('Creating %s',torrentURI);
      
      self.infringements_.add(infringement.campaign,
                              torrentURI,
                              infringement.type,
                              'processor',
                              State.NEEDS_PROCESSING,
                              { score: 10 },
                              {},
                              this);
    })
    .seq(function() {
      logger.info('Creating relation between %s and %s', infringement.uri, torrentURI);
      self.infringements_.addRelation(infringement.campaign, infringement.uri, torrentURI, this);
    })
    .catch(function(err) {
      logger.warn('Unable to process torrent for new relation: %s', err);
    })
    .seq(function() {
      rimraf(tmpFile, function(e) { if (e) console.log(e); });
      done();
      this();
    })
    ;
}

Processor.prototype.addMagnetRelation = function(infringement, done) {
  var self = this;

  try {
    var uri = URI(infringement.uri)
      , queryString = uri.query()
      , queryMap = URI.parseQuery(queryString)
      , hash = queryMap.xt.split(':').last()
      , torrentURI = 'torrent://' + hash
      ;

    logger.info('Creating %s for magnet relation to %s', torrentURI, infringement._id);

    Seq()
      .seq(function() {
        self.infringements_.add(infringement.campaign,
                                torrentURI,
                                infringement.type,
                                'processor',
                                State.NEEDS_PROCESSING,
                                { score: 10 },
                                {},
                                this);
      })
      .seq(function() {
        logger.info('Creating relation between %s and %s', infringement.uri, torrentURI);
        self.infringements_.addRelation(infringement.campaign,
                                        infringement.uri,
                                        torrentURI,
                                        this);
      })
      .catch(function(err) {
        logger.warn('Unable to create relation between %s and %s: %s',
                    infringement.uri, torrentURI, err);
        done();
      })
      .seq(function() {
        done();
        this();
      })

  } catch(err) {
    logger.warn("Unable to parse magnet uri to create relations", infringement._id, infringement.uri);
    done();
  }
}

//
// This filter looks at the url of the new infringement and reduces points if the url
// contains words that match a campaigns list of low-priority words
//
Processor.prototype.reducePointsForCommonFalsePositives = function(infringement, mimetype, done) {
  var self = this
    , matches = self.campaign_.metadata.lowPriorityWordList
    , positive = false
    ;

  if (infringement.verified || !matches || !matches.length)
    return done();

  matches.forEach(function(match) {
    var regex = new RegExp(match, 'i')
      , that = this
      ;
    if (regex.test(infringement.uri)) {
      positive = true;
    }
  });

  if (positive) {
    var count = infringement.points.total ? infringement.points.total : 0;
    var points = count > 5 ? -1 * (count - 5) : 0;

    logger.info('Reducing points of %s: contains low priority words', infringement.uri);
    self.infringements_.addPoints(infringement, 'reducer', points, '', done);

  } else {
    done();
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

  self.started_ = Date.now();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Processor.prototype.end = function() {
  var self = this;

  self.started_ = false;
}

if (process.argv[1] && process.argv[1].endsWith('processor.js')) {
  var processor = new Processor();
  processor.started_ = Date.now();

   Seq()
    .seq(function() {
      processor.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      processor.run(this);
    })
    .seq(function() {
      logger.info('Finished running Processor');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}
