/*
 * downloader.js: the downloader role
 *
 * (C) 2013 Ayatii Limited
 *
 * Downloader role looks for infringements that need downloading, sorts them, 
 * and make a downloader
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('downloader.js')
  , path = require('path')
  , os = require('os')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  , sugar = require('sugar')
  ;

var Campaigns = acquire('campaigns')
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Verifications = acquire('verifications')
  , Mangling = require('./mangling')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  , State = states.infringements.state
  , Storage = acquire('storage')
  ;

var Downloader = module.exports = function() {
  this.campaigns_ = null;
  this.hosts_ = null;
  this.storage_ = null;
  this.infringements_ = null;
  this.verifications_ = null;
  this.jobs_ = null;

  this.started_ = 0;

  this.touchId_ = 0;

  this.downloadersMap_ = {};
  this.workList_ = {};

  this.init();
}

util.inherits(Downloader, Role);

Downloader.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.hosts_ = new Hosts();
  self.storage_ = new Storage('downloads');
  self.infringements_ = new Infringements();
  self.verifications_ = new Verifications();
  self.jobs_ = new Jobs('downloader');
}

Downloader.prototype.processJob = function(err, job) {
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
    logger.warn(err.stack, console.trace());
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
      logger.info('Finished running downloader');
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

Downloader.prototype.preRun = function(job, done) {
  var self = this
    , category = states.infringements.category.CYBERLOCKER
  ;
  
  Seq()
    .seq(function(){
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      // For now we only deal in cyberlockers
      self.hosts_.getDomainsThatSupportLogin(category, this);
    })
    .seq(function(loginHosts) {
      loginHosts.each(function(host){
        //logger.info('found host for automagic ' + host._id);
        self.downloadersMap_[host._id] = host;
      });
      self.createInfringementMap(this);
    })
    .seq(function(workList) {
      self.workList_ = workList.randomize();
      this();
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Downloader.prototype.createInfringementMap = function(done) {
  var self = this
    , category = states.infringements.category.CYBERLOCKER
    ;

  self.infringements_.getNeedsDownloadForCampaign(self.campaign_, category, function(err, infringements) {
    if (err)
      return done(err);
    logger.info('needs-download total: ' + infringements.length);
    var map = {};
    infringements.forEach(function(infringement) {
      var domain = utilities.getDomain(infringement.uri);
      if (map[domain])
        map[domain].push(infringement);
      else
        map[domain] = [infringement];
    });

    var list = [];
    Object.keys(map).forEach(function (key) {
      // This is why sugarjs is like God orgasmed into a .js file
      map[key].inGroupsOf(250).forEach(function(group) {
        var infringements = [];
        group.forEach(function(i) { if (i) infringements.push(i);  });
        list.push({ domain: key, infringements: infringements });
      });
    });

    list = list.sortBy(function(n) {
      return n.domain;
    });

    done(null, list);
  });
}

Downloader.prototype.run = function(done) {
  var self = this;

  if (!self.started_)
    return done();

  if (Date.create(self.started_).isBefore('30 minutes ago')) {
    logger.info('Running for too long, stopping');
    return done();
  }

  var work = self.workList_.shift();
  if (!work) {
    logger.info('No work to do');
    self.emit('finished');
    return done();
  }

  if(!Object.keys(self.downloadersMap_).some(work.domain)){
    logger.info('No automated support for ' + work.domain);
    setTimeout(self.run.bind(self, done), 100);
    return;
  }

  var downloaderWorker = null;

  logger.info('Running downloader for %s with %d infringements', work.domain, work.infringements.length);

  Seq()
    .seq(function() {
      self.makeDownloadWorker(self.downloadersMap_[work.domain], this);
    })
    .seq(function(depsAvailable, downloaderWorker_) {
      if(!depsAvailable)
        return self.jobs_.close(self.job_, states.jobs.state.CANCELLED, 'No deps available for downloaders', done);
    
      downloaderWorker = downloaderWorker_;
      this();
    })
    .set(work.infringements)
    .seqEach(function(infringement){
      self.download(downloaderWorker, infringement, this);
    })
    .seq(function(){
      downloaderWorker.finish(this);
    })
    .catch(function(error) {
      // We don't set a state if the download errored right now
      logger.warn('Unable to download %s:', error);
    })    
    .seq(function(){ 
      setTimeout(self.run.bind(self, done), 100);
    })
    ;
}

/*
 * Attempts to call download on the worker and then interpret results as it sees fit
 * Too verbose but for the short term lets leave the debug flowing. 
 */
Downloader.prototype.download = function(downloadWorker, infringement, done){
  var self = this;
  Seq()
    .seq(function(){
      logger.info('go work ' + infringement.uri);
      downloadWorker.download(infringement, this);
    })
    .seq(function(result){
      if (result.verdict === states.downloaders.verdict.UNAVAILABLE){
        logger.info('BLACK - we think this is UNAVAILABLE');
        self.verifyUnavailable(infringement, this);            
      }
      else if (result.verdict === states.downloaders.verdict.AVAILABLE){
        logger.info('fingers cross - is this AVAILABLE ? - we think we it is !');
        if(result.payLoad.isEmpty()){
          logger.warn('RED: but the array of downloads is empty. - leave at NEEDS_DOWNLOAD');
          return this();
        }
        logger.info('GREEN: should be on S3 already : ' + JSON.stringify(result.payLoad));
        self.registerDownloadsAndSetState(infringement, result.payLoad);
      }
      else if (result.verdict === states.downloaders.verdict.FAILED_POLICY){
        logger.info('BROWN - We think this downloaded something but failed the download policy.');
        if(!result.payLoad.isEmpty()){
          logger.warn('RED: but the array of downloads is NOT empty. - leave at NEEDS_DOWNLOAD');
          return this();
        }
        var newState = states.infringements.state.FALSE_POSITIVE;
        self.infringements_.setState(infringement, newState, this);        
      }
      else if (result.verdict === states.downloaders.verdict.RUBBISH){
        var newState = states.infringements.state.FALSE_POSITIVE;
        logger.info('WHITE - We think this is rubbish');
        self.infringements_.setState(infringement, newState, this);        
      }
      else if (result.verdict === states.downloaders.verdict.STUMPED){
        logger.warn('YELLOW - i.e. fail colour - yep STUMPED - leave at NEEDS_DOWNLOAD');
        this();
      }
    })
    .seq(function() {
      logger.info('done and dusted with ' + infringement.uri);
      done();
    })
    .catch(function(err){
      logger.warn('Unable to goMangle : %s', err);
      done(err);
    })
    ;    
}

Downloader.prototype.registerDownloadsAndSetState = function(infringement, downloads, done){
  var self = this;
  Seq(downloads)
    .seqEach(function(download){
      self.infringements_.addDownload(infringement,
                                      download.md5,
                                      download.mimetype,
                                      download.size,
                                      this);
    })
    .seq(function(){
      var newState = states.infringements.state.UNVERIFIED;
      self.infringements_.setState(infringement, newState, this);     
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/*
 * Depending on the approach defined on the host
 * this will create an Approach based downloadWorker.
 */
Downloader.prototype.makeDownloadWorker = function(host, done){
  var self = this;
  if(host.downloaderDetails.approach === states.downloaders.approach.COWMANGLING){
    var mangler = new Mangling(self.campaign_, host, function(err, available){
      done(err, mangler, available);
    });
    //mangler.createTab(done);
  }
}

Downloader.prototype.verifyUnavailable = function(infringement, done) {
  var self = this;

  self.infringements_.setStateBy(infringement, State.UNAVAILABLE, 'downloader', function(err){
    if (err)
      logger.warn('Error setting %s to UNAVAILABLE: %s', infringement.uri, err);
    done();
  });
}

//
// Overrides
//
Downloader.prototype.getName = function() {
  return "downloader";
}

Downloader.prototype.start = function() {
  var self = this;

  self.started_ = Date.now();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Downloader.prototype.end = function() {
  var self = this;
  self.started_ = false;
}

if (process.argv[1] && process.argv[1].endsWith('download-manager.js') && process.argv[2] && process.argv[2] === 'raw'){
  var downloadMgr = new Downloader();
  downloadMgr.started_ = Date.now();

   Seq()
    .seq(function() {
      downloadMgr.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      downloadMgr.run(this);
    })
    .seq(function() {
      logger.info('Finished running Downloader');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}