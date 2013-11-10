/*
 * download-manager.js: the download manager
 *
 * (C) 2012 Ayatii Limited
 *
 * DownloadManager role looks for infringements that need downloading, sorts them, 
 * and hands them to the appropriate downloader
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('download-manager.js')
  , path = require('path')
  , os = require('os')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  , Cowmangler = acquire('cowmangler')
  ;

var Campaigns = acquire('campaigns')
  , Downloads = acquire('downloads')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  , State = states.infringements.state
  ;

var PLUGINS = [
   '4shared'
  ,'zippyshare'
];
  /*  '4shared'
  , 'mediafire'
  , 'sharebeast'
  , 'rapidshare'
  , 'hulkshare'*/


var DownloadManager = module.exports = function() {
  this.campaigns_ = null;
  this.downloads_ = null;
  this.infringements_ = null;
  this.jobs_ = null;

  this.started_ = 0;

  this.touchId_ = 0;

  this.downloadersMap_ = {};
  this.workList_ = {};

  this.init();
}

util.inherits(DownloadManager, Role);

DownloadManager.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.downloads_ = new Downloads();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('downloader');
}

DownloadManager.prototype.processJob = function(err, job) {
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

DownloadManager.prototype.preRun = function(job, done) {
  var self = this;

  self.browser = new Cowmangler();
  self.browser.on('error', function(err){done(err)});

  Seq()
    .seq(function(){

      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      //logger.info('we have this campaign ' + JSON.stringify(campaign));
      self.campaign_ = campaign;
      self.loadDownloaders(this);
    })
    .seq(function() {
      self.createInfringementMap(this);
    })
    .seq(function(workList){
      logger.info('work length = ' + workList.length);
      var that = this;
      if(!job.downloader)
        return this(null, workList);

      workList.each(function(work){
        var result = [];
        logger.info('domain : ' + work.domain + ' count : ' + work.infringements.length);
        if(work.domain && work.domain === job.downloader){
          logger.info('right do it for downloader : ' + job.downloader);
          that(null, [{domain: work.domain , infringements : work.infringements}]);
        }
      });
      that(null, workList);
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

DownloadManager.prototype.loadDownloaders = function(done) {
  var self = this;

  PLUGINS.forEach(function(pluginName) {
    var plugin = require('./' + pluginName)
    var domains = plugin.getDomains();
    domains.forEach(function(domain) {
      self.downloadersMap_[domain]  = pluginName;
    });
  });

  done();
}

DownloadManager.prototype.createInfringementMap = function(done) {
  var self = this
    , category = states.infringements.category.CYBERLOCKER
    ;

  self.infringements_.getNeedsDownloadForCampaign(self.campaign_, category, function(err, infringements) {
    if (err)
      return done(err);

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

DownloadManager.prototype.run = function(done) {
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
    return done();
  }

  var plugin = null;

  logger.info('Running downloader for %s with %d infringements', work.domain, work.infringements.length);

  Seq()
    .seq(function() {
      self.getPluginForDomain(work.domain, this);
    })
    .seq(function(plugin_) {
      plugin = plugin_;
      this(null, work.infringements);
    })
    .seq(function(infringements){ //add more approaches or strategies. 
      if(plugin.attributes.approach === states.downloaders.method.COWMANGLING)
        self.mangle(infringements, plugin, this);
      else(plugin.attributes.approach === states.downloaders.method.RESTFUL)
        self.restful(infringements, plugin, this);
    })
    .catch(function(error) {
      // We don't set a state if the download errored right now
      logger.warn('Unable to download %s: %s', infringement.uri, error);
    })    
    .seq(function(){ 
      setTimeout(self.run.bind(self, done), 100);
    })
    ;
}

DownloadManager.prototype.getPluginForDomain = function(domain, done) {
  var self = this
    , err = null
    , pluginName = self.downloadersMap_[domain]
    , plugin = null
    ;

  if (!pluginName) {
    err = 'Cyberlocker ' + domain + ' is not support for auto-download';
  } else {
    try {
      plugin = new (require('./' + pluginName))(self.campaign_, self.browser);
    } catch(error) {
      err = error;
    }
  }

  if (!plugin && !err)
    err = 'Unable to load plugin for domain ' + domain + ': unknown';

  done(err, plugin);
}

DownloadManager.prototype.mangle = function(infringements, plugin, done){
  Seq(infringements)
    .seqEach(function(infringement) {
      self.goMangle(infringement, plugin, this);
    })
    .seq(function() {
      plugin.finish();
      done();
    })
    .catch(function(err){
      logger.warn('Unable to Mangle : %s', err);
      done(err);
    })
    ;
}

DownloadManager.prototype.goMangle = function(infringement, plugin, done){
  Seq()
    .seq(function(){
      plugin.download(infringement, this);
    })
    .seq(function(result){
      if (result.verict === states.downloaders.verdict.UNAVAILABLE){
        logger.info('BLACK - we think this is UNAVAILABLE');
        //self.verifyUnavailable(infringement, this);            
      }
      else if (result.verict === states.downloaders.verdict.AVAILABLE){
        logger.info('fingers cross - is this AVAILABLE ? - we think we do !');
        if(result.payload.isEmtpy()){
          logger.warn('RED: but the array of downloads is empty. - leave at NEEDS_DOWNLOAD');
          return this();
        }
        Logger.info('GREEN: we think we want to store : ' + JSON.stringify(result.payload));
        /*var newState = states.infringements.state.UNVERIFIED;
        logger.info('Setting state %d on %s', newState, infringement.uri);
        self.infringements_.setState(infringement, newState, this);*/
      }
      else if (result.verict === states.downloaders.verdict.RUBBISH){
        //var newState = states.infringements.state.FALSE_POSITIVE;
        logger.info('WHITE - We think this is rubbish');
        //self.infringements_.setState(infringement, newState, this);        
      }
      else if (result.verict === states.downloaders.verdict.STUMPED){
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

// TODO - for RESTFUL strategies
DownloadManager.prototype.restful = function(infringements, plugin, done){
  done();
}


DownloadManager.prototype.goManual = function(infringement, plugin, done) {
  var self = this
    , tmpDir = path.join(os.tmpDir(), 'downloader-' + Date.now() + '-' + infringement._id)
    , started = Date.now()
    , newState = states.infringements.state.UNVERIFIED
    ;

  logger.info('Downloading %s to %s', infringement.uri, tmpDir);

  Seq()
    .seq(function() {
      rimraf(tmpDir, this);
    })
    .seq(function() {
      fs.mkdir(tmpDir, this);
    })
    .seq(function() {
      plugin.download(infringement, tmpDir, this);
    })
    .seq(function() {
      self.downloads_.addLocalDirectory(infringement, tmpDir, started, Date.now(), this);
    })
    .seq(function(nUploaded) {
      // TODO - needs to be integrated into whatever manual process needs it
      rimraf(tmpDir, this);
    })
    .seq(function() {
      done();
    })
    ;
}

DownloadManager.prototype.verifyUnavailable = function(infringement, done) {
  var self = this;

  if (infringement.state != State.UNAVAILABLE)
    return done();

  var verification = { state: State.UNAVAILABLE, who: 'downloader', started: Date.now(), finished: Date.now() };
  self.verifications_.submit(infringement, verification, function(err) {
    if (err)
      logger.warn('Error verifiying %s to UNAVAILABLE: %s', infringement.uri, err);
    done();
  });
}

//
// Overrides
//
DownloadManager.prototype.getName = function() {
  return "downloader";
}

DownloadManager.prototype.start = function() {
  var self = this;

  self.started_ = Date.now();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

DownloadManager.prototype.end = function() {
  var self = this;

  self.started_ = false;
}

if (process.argv[1] && process.argv[1].endsWith('download-manager.js') && process.argv[2] && process.argv[2] === 'raw'){
  var downloadMgr = new DownloadManager();
  downloadMgr.started_ = Date.now();

   Seq()
    .seq(function() {
      downloadMgr.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      downloadMgr.run(this);
    })
    .seq(function() {
      logger.info('Finished running DownloadManager');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}