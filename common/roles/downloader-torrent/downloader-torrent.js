/*
 * downloader-torrents.js: the downloader
 *
 * (C) 2012 Ayatii Limited
 *
 * DownloaderTorrent role for torrents
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('downloader-torrent.js')
  , path = require('path')
  , os = require('os')
  , readTorrent = require('read-torrent')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  , wranglerRules = acquire('wrangler-rules')
  ;

var Campaigns = acquire('campaigns')
  , Extensions = acquire('wrangler-rules').typeMediaExtensions
  , Infringements = acquire('infringements')
  , Storage = acquire('storage')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  , State = states.infringements.state
  , Verifications = acquire('verifications')
  ;

var TorrentClient = require('./torrent-client');

var DownloaderTorrent = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.infringementsCollection_ = null;
  this.jobs_ = null;
  this.verifications_ = null;
  this.storage_ = null;

  this.started_ = 0;
  this.touchId_ = 0;

  this.downloadDir_ = null;
  this.runDone_ = null;
  this.torrentClient_ = null;

  this.init();
}

util.inherits(DownloaderTorrent, Role);

DownloaderTorrent.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('downloader-torrent');
  self.verifications_ = new Verifications();
  self.storage_ = new Storage('downloads');

  database.connectAndEnsureCollection('infringements', function(err, db, collection) {
    if (err)
      return logger.error(err);

    self.infringementsCollection_ = collection;
  });
}

DownloaderTorrent.prototype.processJob = function(err, job) {
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

  self.jobs_.start(job);

  Seq()
    .seq(function() {
      self.preRun(job, this);
    })
    .par(function() {
      self.run(this);
    })
    .seq(function() {
      logger.info('Finished running torrent downloader');
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to download job %j: %s', job, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

DownloaderTorrent.prototype.preRun = function(job, done) {
  var self = this;

  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.downloadDir_ = path.join(os.tmpDir(), 'downloader-torrent-' + utilities.genLinkKey(campaign.name));
      this();
    })
    .seq(function() {
      var that = this;

      logger.info('Creating download directory %s', self.downloadDir_);
      self.tryMakeDir(self.downloadDir_, this);
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

DownloaderTorrent.prototype.run = function(done) {
  var self = this;

  logger.info('Running torrent downloader for %s', self.campaign_.name);

  self.runDone_ = done;

  self.torrentClient_ = new TorrentClient(self.campaign_);
  self.torrentClient_.on('getTorrent', self.getTorrent.bind(self));
  self.torrentClient_.on('torrentFinished', self.torrentFinished.bind(self));
  self.torrentClient_.on('torrentErrored', self.torrentErrored.bind(self));
  self.torrentClient_.on('finished', self.clientFinished.bind(self));
  self.torrentClient_.on('error', self.clientErrored.bind(self));

  self.torrentClient_.start();
}

DownloaderTorrent.prototype.getTorrent = function() {
  var self = this
    , infringement = null
    ;

  self.popInfringement(function(err, infringement) {
    if (err)
      return logger.warn('Unable to get infringement to download: %s', err);

    if (!infringement)
      return logger.info('No infringements to process');

    // Hold onto the lock for the infringement
    infringement.downloadTimer = setInterval(self.infringements_.touch.bind(self.infringements_, infringement),
                                             5 * 60 * 1000);
    infringement.downloadStarted = Date.now();
    self.torrentClient_.add(infringement);
  });
}

DownloaderTorrent.prototype.popInfringement = function(callback) {
  var self = this;

  self.popOne(function(err, infringement) {
    if (err) {
      logger.warn('Unable to get infringement from database %s', err)
      logger.info('Attempting to get another infringement');
      setTimeout(self.popInfringement.bind(self, callback), 1000 * 2);
      return;
    }
    
    if (!infringement)
      return callback();

    self.getTorrentDetails(infringement, function(err, details) {
      if (err) {
        logger.warn('Getting torrent details failed: %s', err);
        self.infringements_.setStateBy(infringement, State.UNAVAILABLE, 'downloader-torrent', function(err) {
          if (err)
            logger.warn('Unable to update state for %s: %s', infringement._id, err);
        });
        logger.info('Attempting to get another infringement');
        setTimeout(self.popInfringement.bind(self, callback), 1000 * 2);
        return;
      }

      if (!details) {
        logger.warn('Unable to load torrent details for %s, setting up for manual verification', infringement._id);
        self.infringements_.setStateBy(infringement, State.DEFERRED, 'downloader-torrent', function(err) {
          if (err)
            logger.warn('Unable to update state for %s: %s', infringement._id, err);
        });

        logger.info('Attempting to get another infringement');
        setTimeout(self.popInfringement.bind(self, callback), 1000 * 2);
        return;
      }

      self.checkIfTorrentIsGoodFit(details, infringement, function(err, good, reason) {
        if (err) {
          logger.warn('Unable to process %s for good fit: %s', infringement._id, err)
          logger.info('Attempting to get another infringement');
          setTimeout(self.popInfringement.bind(self, callback), 1000 * 2);
          return;
        }

        if (!good) {
          logger.info('Infringement %s isn\'t a good fit: %s', infringement._id, reason);

          self.infringements_.setStateBy(infringement, State.FALSE_POSITIVE, 'downloader-torrent', function(err){
            if (err)
              logger.warn('Error setting %s to FALSE_POSITIVE: %s', infringement.uri, err);
          });

          logger.info('Attempting to get another infringement');
          setTimeout(self.popInfringement.bind(self, callback), 1000 * 2);
          return;
        }

        callback(null, infringement);
      });
    });
  });
}

DownloaderTorrent.prototype.popOne = function(done) {
  var self = this
    , then = Date.create('30 minutes ago').getTime()
    ;

  var query = {
    'campaign': self.campaign_._id,
    scheme: 'torrent',
    'children.count': 0,
    state: states.infringements.state.NEEDS_DOWNLOAD,
    popped: {
      $lt: then
    },
    'metadata.processedBy': {
      $ne: 'downloader-torrent'
    }
  };

  var sort = [['created', 1 ] ];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  var options = { new: true };
  
  self.infringementsCollection_.findAndModify(query, sort, updates, options, done);
}

DownloaderTorrent.prototype.getTorrentDetails = function(infringement, done) {
  var self = this
    , error = null
    , filename = path.join(self.downloadDir_, infringement._id)
    , gotFile = false
    , details = null
    ;

  Seq(infringement.parents.uris)
    .seqEach(function(uri) {
      var that = this;

      if (gotFile) {
        that();
        return;
      }

      if (uri.startsWith('magnet:')) {
        that();
        return;
      }

      utilities.requestStream(uri, function(err, req, res, stream) {
        if (err) {
          error = err;
          that();
          return;
        }
        stream.pipe(fs.createWriteStream(filename));
        stream.on('end', function() { 
          gotFile = true;
          that();
        });
        stream.on('error', function(err) {
          error = err;
          that();
        });
      });
    })
    .seq(function() {
      if (!gotFile) {
        done(error);
        return;
      }

      readTorrent(filename, this);
    })
    .seq(function(details) {
      rimraf(filename, this.ok);
      done(null, details);
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

DownloaderTorrent.prototype.checkIfTorrentIsGoodFit = function(torrent, infringement, done) {
  var self = this
    , campaignName = self.campaign_.name
    , campaignNameRegExp = new RegExp('(' + campaignName.replace(/\ /gi, '|') + ')', 'i')
    , campaignReleaseDate = self.campaign_.metadata.releaseDate
    , type = self.campaign_.type
    , created = Date.create(torrent.created)
    , name = torrent.name
    , totalSize = 0
    , filenames = []
    , minSize = 0
    , maxSize = 4 * 1024 * 1024 //4GB for video file
    , requiredExentions = []
    , points = 0
    ;

  logger.info('Checking if %s is a good fit', torrent.name);

  // Load up the basics
  torrent.files.forEach(function(file) {
    filenames.push(file.name);
    totalSize += file.length;
  });

  // First check the date and the name. Either not matching is automatic fail
  if (created.isBefore(campaignReleaseDate)) {
    done(null, false, util.format('%s created before release data of media (%s < %s)', name, created, campaignReleaseDate));
    return;
  }

  if (!name.match(campaignNameRegExp)) {
    done(null, false, util.format('%s doesn\'t contain the name of the campaign (%s)', name, campaignName));
    return;
  }

  // Setup the per-type contraints
  if (type.startsWith('music')) {
    minSize = 3 * 1024 * 1024;
    maxSize = 300 * 1024 * 1024;
    requiredExentions.add(Extensions[type]) 
  
  } else if (type.startsWith('movie')) {
    minSize = 300 * 1024 * 1024;
    requiredExentions.add(Extensions[type])

  } else {
    done(null, false, util.format('Unsupported campaign type for %s: %s', type))
    return;
  }

  // Check type constraints
  if (totalSize < minSize) {
    done(null, false, util.format('%s size is too small (%d < %d)', name, totalSize, minSize));
    return;
  }

  if (totalSize > maxSize) {
    done(null, false, util.format('%s size is too large (%d > %d)', name, totalSize, maxSize));
    return;
  }
  
  var oneMatched = false;
  filenames.forEach(function(filename) {
    requiredExentions.forEach(function(ext) {
      if (filename.endsWith(ext))
        oneMatched = true;
    });
  });

  if (!oneMatched) {
    done(null, false, util.format('%s didn\'t contain any matching file extensions', name));
    return;
  }

  // \o/
  done(null, true);
}

DownloaderTorrent.prototype.torrentFinished = function(infringement, directory) {
  var self = this;

  logger.info('Infringement %s has finished downloading to %s, registering new files', infringement._id, directory);

  clearInterval(infringement.downloadTimer);

  Seq()
    .seq(function() {
      self.storage_.addLocalDirectory(infringement.campaign,
                                      directory,
                                      this);
    })
    .seq(function() {
      rimraf(directory, this.ok);
    })
    .seq(function() {
      self.infringements_.setStateBy(infringement, states.infringements.state.UNVERIFIED, 'downloader-torrent', this);
    })
    .seq(function() {
      logger.info('Sucessfully registered downloads for %s', infringement._id);
    })
    .catch(function(err) {
      logger.warn('Unable to register downloads for %s (%s): %s', infringement._id, infringement.uri, err);
      // FIXME: Register this shiznit somewhere
    })
    ;
}

DownloaderTorrent.prototype.torrentErrored = function(err, infringement) {
  var self = this;

  logger.warn('Unable to download %s (%s): %s', infringement._id, infringement.uri, err);
  self.infringements_.setStateBy(infringement, states.infringements.state.UNVERIFIED, 'downloader-torrent', function(err) { if (err) logger.warn(err); });
}

DownloaderTorrent.prototype.clientFinished = function() {
  var self = this;
  self.runDone_();
}

DownloaderTorrent.prototype.clientErrored = function(err) {
  var self = this;
  self.runDone_(err);
}

DownloaderTorrent.prototype.tryMakeDir = function(name, done) {
  fs.mkdir(name, 0777, function(err) {
    if (!err) {
      return done();
    } else if (err.code == 'EEXIST') {
      logger.info('Using pre-existing download directory');
      done();
    } else {
      done(err);
    }
  });
}

//
// Overrides
//
DownloaderTorrent.prototype.getName = function() {
  return "downloader-torrent";
}

DownloaderTorrent.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

DownloaderTorrent.prototype.end = function() {
  var self = this;

  self.started_ = false;

  // FIXME: ADD API TO REMOVE ALL RUNNING TORRENTS
  self.emit('ended');
}

//
// Neil's lazy work-without-a-real-job hack
//
if (process.argv[1] && process.argv[1].endsWith('downloader-torrent.js')) {
  var downloader = new DownloaderTorrent();
  downloader.started_ = Date.now();

   Seq()
    .seq(function() {
      downloader.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      downloader.run(this);
    })
    .seq(function() {
      logger.info('Finished running DownloaderTorrent');
      process.exit(1);
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}
