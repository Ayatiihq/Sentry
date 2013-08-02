/*
 * unarchiver.js: the unarchiver
 *
 * (C) 2012 Ayatii Limited
 *
 * Unarchiver processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fmt = require('util').format
  , fs = require('fs')
  , logger = acquire('logger').forFile('unarchiver.js')
  , os = require('os')
  , path = require('path')
  , rarfile = require('rarfile')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , unzip = require('unzip')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Downloads = acquire('downloads')
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , Storage = acquire('storage')
  , Verifications = acquire('verifications')
  ;

var PROCESSOR = 'unarchiver';

var Unarchiver = module.exports = function() {
  this.campaigns_ = null;
  this.downloads_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.verifications_ = null;
  this.storage_ = null;

  this.campaign_ = null;

  this.supportedMimeTypes_ = [];

  this.started_ = 0;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Unarchiver, Role);

Unarchiver.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.downloads_ = new Downloads();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('unarchiver');
  self.verifications_ = new Verifications();
  self.storage_ = new Storage('downloads');
}

Unarchiver.prototype.loadVerifiers = function(done) {
  var self = this;

  self.supportedMimeTypes_ = [
    // 'application/x-7z-compressed'
    //, 'application/x-bzip2'
    //, 'application/x-gzip'
      'application/x-rar'
    , 'application/x-rar-compressed'
    //, 'application/zip'
  ];

  done();
}

Unarchiver.prototype.processJob = function(err, job) {
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
      self.loadVerifiers(this);
    })
    .seq(function() {
      self.processVerifications(this);
    })
    .seq(function() {
      logger.info('Finished unarchiving session');
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

Unarchiver.prototype.processVerifications = function(done) {
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
      logger.warn('Unable to process %s for unarchiving: %s', infringement._id, err);
      self.infringements_.processedBy(infringement, PROCESSOR);
      setTimeout(self.processVerifications.bind(self, done), 1000);
      return;
    }

    self.downloads_.getInfringementDownloads(infringement, function(err, downloads) {
      if (err)
        return closeAndGotoNext(err, infringement);

      self.processVerification(infringement, downloads, function(err) {
        if (err)
          return closeAndGotoNext(err, infringement);

        self.infringements_.processedBy(infringement, PROCESSOR);

        setTimeout(self.processVerifications.bind(self, done), 1000);
      });
    });
  });
}

Unarchiver.prototype.processVerification = function(infringement, downloads, done) {
  var self = this
    , archives = []
    ;

  downloads.forEach(function(download) {
    if (self.supportedMimeTypes_.some(download.mimetype))
      archives.push(download);
  });

  if (!archives.length)
    return done(fmt('Has no downloads that we can unarchive', infringement._id));

  logger.info('Unarchiving %d links for %s', archives.length, infringement._id);
  self.unarchiveAll(infringement, archives, done);
}

Unarchiver.prototype.unarchiveAll = function(infringement, archives, done) {
  var self = this;

  var archive = archives.pop();
  self.unarchive(infringement, archive, function(err) {
    if (err)
      logger.warn(fmt('Unable to unarchive %s for %s: %s', archive.name, infringement._id, err));
    
    if (archives.length)
      setTimeout(self.unarchiveAll.bind(self, infringement, archives, done), 1000);
    else
      done(err);
  });
}

Unarchiver.prototype.unarchive = function(infringement, archive, done) {
  var self = this
    , tmpFile = path.join(os.tmpDir(), 'archive-'+ infringement._id + '-' + archive.name)
    , tmpFileStream = fs.createWriteStream(tmpFile)
    , tmpDir = path.join(os.tmpDir(), 'unarchiver-'+ infringement._id + '-' + archive.name)
    , uri = self.storage_.getURL(archive.name)
    , started = Date.now()
    ;

  fs.mkdir(tmpDir, function(err) {
    if (err) return done(err);

    logger.info('Downloading %s', uri);
    utilities.requestStream(uri, {}, function(err, req, res, stream) {
      if (err) return done(err);

      stream.pipe(tmpFileStream);
      stream.on('error', done);
      stream.on('end', function() {
        self.extractArchive(tmpFile, tmpDir, archive.mimetype, function(err) {
          if (err) return done(err);

          logger.info('Uploading %s', tmpDir)
          self.downloads_.addLocalDirectory(infringement, tmpDir, started, Date.now(), function(err) {

            rimraf(tmpFile, function(err) { if (err) logger.warn(err); });
            rimraf(tmpDir, function(err) { if (err) logger.warn(err); });

            done(err);
          });
        });
      });
    });
  });
}

Unarchiver.prototype.extractArchive = function(file, dir, mimetype, done) {
  var self = this;

  if (['application/zip'].some(mimetype))
    self.extractZip(file, dir, done);

  else if (['application/x-rar', 'application/x-rar-compressed'].some(mimetype))
    self.extractRar(file, dir, done);

  else
    done(fmt('Mimetype %s unsupported', mimetype));
}

Unarchiver.prototype.extractZip = function(file, dir, done) {
  var self = this
    , extractor = unzip.Extract({ path: dir })
    ;

  logger.info('Extracting zip %s', file);
  
  extractor.on('error', done);
  extractor.on('close', done);
  fs.createReadStream(file).pipe(extractor);
}

Unarchiver.prototype.extractRar = function(file, dir, done) {
  var self = this
    , rar = new rarfile.RarFile(file)
    ;

  rar.on('ready', function() {
    logger.info('Extracting rar %s', file);
    var names = rar.names;
    self.extractRarFiles(rar, dir, names, done);
  });
}

Unarchiver.prototype.extractRarFiles = function(rar, dir, names, done) {
  var self = this
    , filename = names.pop()
    ;

  if (!filename)
    return done();

  var outfile = path.join(dir, filename.split('/').last())
    , outfileStream = fs.createWriteStream(outfile)
    ;

  rar.pipe(filename, outfileStream);
  outfileStream.on('error', done);
  outfileStream.on('close', function() {
    if (names.length)
      setTimeout(self.extractRarFiles.bind(self, rar, dir, names, done), 500);
    else
      done();
  });
}

//
// Overrides
//
Unarchiver.prototype.getName = function() {
  return "unarchiver";
}

Unarchiver.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Unarchiver.prototype.end = function() {
  var self = this;

  self.started_ = false;
}