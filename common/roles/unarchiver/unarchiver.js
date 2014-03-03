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
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , Storage = acquire('storage')
  ;

var PROCESSOR = 'unarchiver';

var Unarchiver = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.verifications_ = null;
  this.storage_ = null;

  this.campaign_ = null;

  this.supportedMimeTypes_ = [];

  this.started_ = 0;
  this.touchId_ = 0;

  Role.call(this);
  this.init();
}

util.inherits(Unarchiver, Role);

Unarchiver.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('unarchiver');
  self.storage_ = new Storage('downloads');
}

Unarchiver.prototype.loadMimetypes = function(done) {
  var self = this;

  self.supportedMimeTypes_ = [
    // 'application/x-7z-compressed'
    //, 'application/x-bzip2'
    //, 'application/x-gzip'
      'application/x-rar'
    , 'application/x-rar-compressed'
    , 'application/zip'
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
      self.loadMimetypes(this);
    })
    .seq(function() {
      self.processDownloads(this);
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

Unarchiver.prototype.processDownloads = function(done) {
  var self = this;

  if (!self.started_)
    return done();

  if (self.started_.isBefore('30 minutes ago')) {
    logger.info('Been running for long enough, quitting');
    return done();
  }

  var options = {};
  options.mimetypes = self.supportedMimeTypes_;
  options.notProcessedBy = PROCESSOR;
  
  self.infringements_.popForCampaignByMimetypes(self.campaign_, options, function(err, infringement) {
    if (err)
      return done(err);

    if (!infringement) {
      logger.info('Ran out of infringements (downloads) to process');
      return done();
    }

    function closeAndGotoNext(err, infringement) {
      logger.warn('Unable to process %s for unarchiving: %s', infringement._id, err);
      self.infringements_.processedBy(infringement, PROCESSOR);
      setTimeout(self.processDownloads.bind(self, done), 1000);
      return;
    }

    self.unarchive(infringement, function(err) {
      if (err)
        return closeAndGotoNext(err, infringement);
      self.infringements_.processedBy(infringement, PROCESSOR);
      setTimeout(self.processDownloads.bind(self, done), 1000);
    });
  });
}

Unarchiver.prototype.unarchive = function(infringement, done) {
  var self = this;
  
  relevantDownloads = infringement.downloads.filter(function(dl){ return self.supportedMimeTypes_.some(dl.mimetype)});

  Seq(relevantDownloads)
    .seqEach(function(download){
      self.unarchiveDownload(infringement, download, this);
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Unarchiver.prototype.unarchiveDownload = function(infringement, download, done){
  var self = this
    , started = Date.now()
    , tmpFile = path.join(os.tmpDir(), 'archive-' + download.md5 + '-' + started)
    , tmpFileStream = fs.createWriteStream(tmpFile)
    , tmpDir = path.join(os.tmpDir(), 'unarchiver-'+ download.md5 + '-' + started)
    , uri = self.storage_.getURL(self.campaign_._id, download.md5)
    ;

  Seq()
    .seq(function(){
      var that = this;
      rimraf(tmpDir, function(err) { 
        if (err) 
          logger.warn(err)
        that();
      });
    })
    .seq(function(){
      fs.mkdir(tmpDir, this);      
    })
    .seq(function(){
      utilities.requestStream(uri, this);
    })
    .seq(function(req, res, stream){
      var that = this;
      stream.pipe(tmpFileStream);
      stream.on('error', done);
      stream.on('end', function() {
        self.extractArchive(tmpFile, tmpDir, download.mimetype, function(err) {
          if (err) 
            return done(err);
          self.uploadAndRegister(infringement, tmpFile, tmpDir, that);
        });
      });
    })
    .seq(function(){
      self.infringements_.downloadProcessedBy(infringement, download.md5, PROCESSOR, this);
    })
    .seq(function(){
      logger.trace('finished unarchiving and uploading for download ' + download.md5);
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Unarchiver.prototype.uploadAndRegister = function(infringement, archive, extractedDir, done){
  var self = this;
  self.storage_.addLocalDirectory(infringement.campaign, extractedDir, function(err, nUploaded, fileDetails) {

    rimraf(archive, function(err) { if (err) logger.warn(err); });
    rimraf(extractedDir, function(err) { if (err) logger.warn(err); });
    // Only register downloads that have successfully uploaded.
    Seq(fileDetails)
      .seqEach(function(download){
        self.infringements_.addDownload(infringement,
                                        download.md5,
                                        download.mimetype,
                                        download.size,
                                        this);
      })
      .seq(function(){
        done();
      })
      .catch(function(err){
        done(err);
      })
      ;
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
