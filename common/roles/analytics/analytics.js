  /*
 * analytics.js: the analytics
 *
 * (C) 2012 Ayatii Limited
 *
 * Analytics runs analytics jobs on the database.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('analytics.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Seq = require('seq')
  ;

var HostsCrunchers = require('./hostscrunchers')
  , HostsInfo = require('./hostsinfo')
  , HostsMR = require('./hostsmr')
  , LinkMR = require('./linkmr')
  ;

var Analytics = module.exports = function() {
  this.campaigns_ = null;
  this.jobs_ = null;
  this.settings_ = null;

  this.job_ = null;
  this.campaign_ = null;
  this.collections_ = [];


  this.started_ = false;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Analytics, Role);

Analytics.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.jobs_ = new Jobs('analytics');
  self.settings_ = new Settings('role.analytics');
}

Analytics.prototype.processJob = function(err, job) {
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
    .seq(function() {
      self.run(this);
    })
    .seq(function() {
      logger.info('Finished running analytics');
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

Analytics.prototype.preRun = function(job, done) {
  var self = this;

  var requiredCollections = ['campaigns', 'analytics', 'infringements', 'hosts', 'hostBasicStats', 'hostLocationStats', 'linkStats'];

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
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Analytics.prototype.run = function(done) {
  var self = this;

  Seq(self.loadWork())
    .seqEach(function(work) {
      var that = this;

      work(self.db_,
           self.collections_,
           self.campaign_, 
           function(err) {
        if (err)
          logger.warn(err);

        that();
      });
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Analytics.prototype.loadWork = function() {
  var self = this
    , work = []
    ;

  // Pre-MapReduce
  work.push(HostsInfo.serverInfo);
  work.push(HostsInfo.websiteInfo);

  // Map Reduce
  work.push(HostsMR.preRun);
  
  work.push(HostsMR.hostBasicStats);
  work.push(HostsMR.hostLocationStats);
  work.push(HostsMR.hostClientBasicStats);
  work.push(HostsMR.hostClientLocationStats);

  work.push(LinkMR.preRun);
  work.push(LinkMR.linkStats);
  work.push(LinkMR.linkStatsClient);

  // Post-MapReduce
  work.push(HostsCrunchers.topTenLinkHosts);
  work.push(HostsCrunchers.topTenLinkCountries);
  work.push(HostsCrunchers.topTenLinkCyberlockers);
  work.push(HostsCrunchers.topTenInfringementHosts);
  work.push(HostsCrunchers.topTenInfringementCountries);
  work.push(HostsCrunchers.topTenInfringementCyberlockers);
  
  work.push(HostsCrunchers.linksCount);
  work.push(HostsCrunchers.nTotalCountries);
  work.push(HostsCrunchers.nTotalHosts);

  work.push(HostsCrunchers.nNeedsProcessing);
  work.push(HostsCrunchers.nUnverified);
  work.push(HostsCrunchers.nVerified);
  work.push(HostsCrunchers.nFalsePositive);
  work.push(HostsCrunchers.nSentNotice);
  work.push(HostsCrunchers.nTakenDown);
  work.push(HostsCrunchers.nNeedsScrape);
  work.push(HostsCrunchers.nDeferred);
  work.push(HostsCrunchers.nUnavailable);
  work.push(HostsCrunchers.nNeedsDownload);

  work.push(HostsCrunchers.nWebsites);
  work.push(HostsCrunchers.nSearchResults);
  work.push(HostsCrunchers.nCyberlockers);
  work.push(HostsCrunchers.nFiles);
  work.push(HostsCrunchers.nTorrents);
  work.push(HostsCrunchers.nSocial);

  work.push(HostsCrunchers.topTenLinkHostsClient);
  work.push(HostsCrunchers.topTenLinkCountriesClient);
  work.push(HostsCrunchers.topTenLinkCyberlockersClient);
  work.push(HostsCrunchers.topTenInfringementHostsClient);
  work.push(HostsCrunchers.topTenInfringementCountriesClient);
  work.push(HostsCrunchers.topTenInfringementCyberlockersClient);

  work.push(HostsCrunchers.linksCountClient);
  work.push(HostsCrunchers.nTotalCountriesClient);
  work.push(HostsCrunchers.nTotalHostsClient);
  
  work.push(HostsCrunchers.nNeedsProcessingClient);
  work.push(HostsCrunchers.nUnverifiedClient);
  work.push(HostsCrunchers.nVerifiedClient);
  work.push(HostsCrunchers.nFalsePositiveClient);
  work.push(HostsCrunchers.nSentNoticeClient);
  work.push(HostsCrunchers.nTakenDownClient);
  work.push(HostsCrunchers.nNeedsScrapeClient);
  work.push(HostsCrunchers.nDeferredClient);
  work.push(HostsCrunchers.nUnavailableClient);
  work.push(HostsCrunchers.nNeedsDownloadClient);

  work.push(HostsCrunchers.nWebsitesClient);
  work.push(HostsCrunchers.nSearchResultsClient);
  work.push(HostsCrunchers.nCyberlockersClient);
  work.push(HostsCrunchers.nFilesClient);
  work.push(HostsCrunchers.nTorrentsClient);
  work.push(HostsCrunchers.nSocialClient);

  return work;
}

//
// Overrides
//
Analytics.prototype.getName = function() {
  return "analytics";
}

Analytics.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Analytics.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}

if (process.argv[1] && process.argv[1].endsWith('analytics.js')) {
  var analytics = new Analytics();
  analytics.started_ = Date.now();

   Seq()
    .seq(function() {
      analytics.preRun(require(process.cwd() + '/' + process.argv[2]), this);
    })
    .seq(function() {
      analytics.run(this);
    })
    .seq(function() {
      logger.info('Finished running Analytics');
    })
    .catch(function(err) {
      logger.warn(err);
    })
    ;
}