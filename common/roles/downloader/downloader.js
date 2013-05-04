/*
 * downloader.js: the downloader
 *
 * (C) 2012 Ayatii Limited
 *
 * Downloader role looks for infringements that need downloading, and downloads them.
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
  ;

var Campaigns = acquire('campaigns')
  , Downloads = acquire('downloads')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Seq = require('seq')
  ;

var PLUGINS = [
  '4shared'
];

var Downloader = module.exports = function() {
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

util.inherits(Downloader, Role);

Downloader.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.downloads_ = new Downloads();
  self.infringements_ = new Infringements();
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
  var self = this;

  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.loadDownloaders(this);
    })
    .seq(function() {
      self.createInfringementMap(this);
    })
    .seq(function(workList) {
      self.workList_ = workList;
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

Downloader.prototype.loadDownloaders = function(done) {
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

Downloader.prototype.createInfringementMap = function(done) {
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

Downloader.prototype.run = function(done) {
  var self = this;

  if (Date.create(self.started_).isBefore('75 minutes ago')) {
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
    .set(work.infringements)
    .seqEach(function(infringement) {
      self.downloadOne(infringement, plugin, this);
    })
    .seq(function() {
      plugin.finish();
      this();
    })
    .catch(function(err) {
      logger.warn('Unable to download from %s: %s', work.domain, err);
    })
    .seq(function(){ 
      setTimeout(self.run.bind(self, done), 100);
    })
    ;
}

Downloader.prototype.getPluginForDomain = function(domain, done) {
  var self = this
    , err = null
    , pluginName = self.downloadersMap_[domain]
    , plugin = null
    ;

  if (!pluginName) {
    err = 'Cyberlocker ' + domain + ' is not support for auto-download';
  } else {
    try {
      plugin = new (require('./' + pluginName))(self.campaign_);
    } catch(error) {
      err = error;
    }
  }

  if (!plugin && !err)
    err = 'Unable to load plugin for domain ' + domain + ': unknown';

  done(err, plugin);
}

Downloader.prototype.downloadOne = function(infringement, plugin, done) {
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
      if (nUploaded == 0)
        newState = states.infringements.state.UNAVAILABLE;
      this();
    })
    .seq(function() {
      logger.info('Setting state %d on %s', newState, infringement.uri);
      self.infringements_.setState(infringement, newState, this);
    })
    .catch(function(error) {
      // We don't set a state if the download errored right now
      logger.warn('Unable to download %s: %s', infringement.uri, error);
    })
    .seq(function() {
      rimraf(tmpDir, this);
    })
    .seq(function() {
      done();
    })
    ;
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

  self.emit('ended');
}

if (process.argv[1] && process.argv[1].endsWith('downloader.js')) {
  var downloader = new Downloader();
  downloader.started_ = Date.now();

   Seq()
    .seq(function() {
      downloader.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      downloader.run(this);
    })
    .seq(function() {
      logger.info('Finished running Downloader');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}