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
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('downloader-torrent.js')
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
  , State = states.infringements.state
  ;

var TorrentClient = require('./torrent-client');

var DownloaderTorrent = module.exports = function() {
  this.campaigns_ = null;
  this.downloads_ = null;
  this.infringements_ = null;
  this.jobs_ = null;

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
  self.downloads_ = new Downloads();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('downloader-torrent');
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
      fs.mkdir(self.downloadDir_, function(err) {
        if (!err) {
          return that();
        } else if (err.code == 'EEXIST') {
          logger.info('Using pre-existing download directory');
          that();
        } else {
          that(err);
        }
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

}

DownloaderTorrent.prototype.torrentFinished = function() {

}

DownloaderTorrent.prototype.torrentErrored = function() {

}

DownloaderTorrent.prototype.clientFinished = function() {
  var self = this;
  self.runDone_();
}

DownloaderTorrent.prototype.clientErrored = function(err) {
  var self = this;
  self.runDone_(err);
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