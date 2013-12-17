/*
 * transcoder.js: the Transcoder
 *
 * (C) 2012 Ayatii Limited
 *
 * Transcoder processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fmt = require('util').format
  , fs = require('fs')
  , logger = acquire('logger').forFile('transcoder.js')
  , os = require('os')
  , path = require('path')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , util = require('util')  
  , utilities = acquire('utilities')
  , exec = require('child_process').execFile
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

var PROCESSOR = 'transcoder';

var Transcoder = module.exports = function() {
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

util.inherits(Transcoder, Role);

Transcoder.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.downloads_ = new Downloads();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('transcoder');
  self.verifications_ = new Verifications();
  self.storage_ = new Storage('downloads');
}

Transcoder.prototype.loadVerifiers = function(done) {
  var self = this;
  // for now our usecase just needs to strip the audio
  // from suspected music videos.
  // Therefore our mimetypes of interest are just video.
  self.supportedMimeTypes_ = [  'video/x-ms-asf'
                              , 'video/x-msvideo'
                              , 'video/x-flv'
                              , 'video/quicktime'
                              , 'video/mp4'
                              , 'video/mpeg'
                              , 'video/x-ms-wmv'];

  done();
}

Transcoder.prototype.processJob = function(err, job) {
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
      logger.info('Finished transcoding session');
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

Transcoder.prototype.processVerifications = function(done) {
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
      logger.warn('Unable to process %s for transcoding: %s', infringement._id, err);
      self.infringements_.processedBy(infringement, PROCESSOR);
      setTimeout(self.processVerifications.bind(self, done), 1000);
      return;
    }

    self.processVerification(infringement, function(err) {
      if (err)
        return closeAndGotoNext(err, infringement);

      self.infringements_.processedBy(infringement, PROCESSOR);

      setTimeout(self.processVerifications.bind(self, done), 1000);
    });
  });
}

Transcoder.prototype.processVerification = function(infringement, done) {
  var self = this
    , inputFiles = []
    ;
  
  infringement.downloads.forEach(function(download) {
    if (self.supportedMimeTypes_.some(download.mimetype))
      inputFiles.push(download);
  });

  if (!inputFiles.length)
    return done(fmt('Has no downloads that we need transcoding', infringement._id));

  logger.info('transcoding %d links for %s', inputFiles.length, infringement._id);
  self.transcodeAll(infringement, inputFiles, done);
}

Transcoder.prototype.transcodeAll = function(infringement, inputFiles, done) {
  var self = this;

  var input = inputFiles.pop();
  self.transcode(infringement, input, function(err) {
    if (err)
      logger.warn(fmt('Unable to transcode %s for %s: %s', input.md5, infringement._id, err));
    
    if (inputFiles.length)
      setTimeout(self.transcodeAll.bind(self, infringement, inputFiles, done), 1000);
    else
      done(err);
  });
}

Transcoder.prototype.transcode = function(infringement, input, done) {
  var self = this
    
    , tmpFile = path.join(os.tmpDir(), 'input-'+ infringement._id + '-' + input.md5)
    , tmpFileStream = fs.createWriteStream(tmpFile)
    , tmpDir = path.join(os.tmpDir(), 'transcoder-'+ infringement._id + '-' + input.md5)
    , uri = self.storage_.getURL(input.md5)
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
        self.convert(tmpFile, tmpDir, function(err){
          if(err) return done(err)

          logger.info('Uploading %s', tmpDir)
     
          self.infringements_.addLocalDirectory(infringement, tmpDir, started, Date.now(), function(err) {

            rimraf(tmpFile, function(err) { if (err) logger.warn(err); });
            rimraf(tmpDir, function(err) { if (err) logger.warn(err); });

            done(err);
          });
        });
      });
    });
  });
}

Transcoder.prototype.convert = function(tmpFile, tmpDir, done){
  var self = this;
  exec('avconv',
       ['-i', tmpFile, path.join(tmpDir, 'output.mp3')],
       function (err, stdout, stderr){
          if (err) return done(err);
          if (stderr) logger.warn(stderr);
          if (stdout) logger.info(stdout);
          done();
        });
}
//
// Overrides
//
Transcoder.prototype.getName = function() {
  return "transcoder";
}

Transcoder.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Transcoder.prototype.end = function() {
  var self = this;

  self.started_ = false;
}
