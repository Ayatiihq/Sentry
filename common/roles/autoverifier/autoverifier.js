/*
 * Autoverifier.js: the awesome AutoVerifier
 * (C) 2013 Ayatii Limited
 * AutoVerifier processes infringements that need downloading and attempts to autoverify them depending on the campaign type. 
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('verifier.js')
  , Seq = require('seq')
  , states = acquire('states')
  , util = require('util')
  , fs = require('fs')
  , os = require('os')
  , Promise = require('node-promise').Promise
  , path = require('path')
  , unzip = require('unzip')
  , request = require('request')
  , rimraf = require('rimraf')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Settings = acquire('settings')
  ;

var MAX_LINKS = 100;

var AutoVerifier = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.settings_ = null;
  this.jobs_ = null;
  this.started_ = false;
  this.lastTimestamp_ = 0;
  this.init();
}

util.inherits(AutoVerifier, Role);

AutoVerifier.prototype.init = function() {
  var self = this;
  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.settings_ = new Settings('role.autoverifier');
  self.jobs_ = new Jobs('autoverifier');
  self.records = {};
}

AutoVerifier.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  logger.info('Processing %j', job._id);

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }

  Seq()
    .seq('Job has details', function() {
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq('Job is valid', function(campaign) {
      job.campaign = campaign;
      // We'll need this !
      //self.checkJobValidity(job, this);
    })
    .seq('Start job', function() {
      self.startJob(job, this);
    })
    .seq('Done', function() {
      logger.info('Finished all work');
      self.emit('finished');
    })
    .catch(onError)
    ;

  process.on('uncaughtException', onError);
}

AutoVerifier.prototype.checkJobValidity = function(job, callback) {
  var self = this;
}

AutoVerifier.prototype.startJob = function(job, done) {
  var self = this;
}

//
// Overrides
//
AutoVerifier.prototype.getName = function() {
  return "autoverifier";
}

AutoVerifier.prototype.start = function(campaign) {
  var self = this;
  self.started_ = true;
  self.emit('started');
  var promise = self.createParentFolder(campaign);
  promise.then(function(err){
    if(err){
      self.end();
      return;
    }
    self.fetchFiles(campaign).then(function(success){
      if(!success)
        self.end();
    });
  });
}

AutoVerifier.prototype.createParentFolder = function(campaign) {
  var self = this;
  var promise = new Promise();
  var now = Date.now();
  var name = [campaign.name.replace(/\s/,""),
              '-',
              now,
              '-',
              process.pid,
              '-',
              (Math.random() * 0x100000000 + 1).toString(36)].join('');
  self.records.parent = path.join(os.tmpDir(), name); 
  fs.mkdir(self.records.parent, function(err){
    if(err)
      logger.error('Error creating parenting folder called ' + self.records.parent);
    promise.resolve(err);
  });
  return promise;
}

/*
 * Assumption files are in a zip
 */
AutoVerifier.prototype.fetchFiles = function(campaign) {
  var self = this;
  var promise = new Promise();
  if(!campaign.uri.endsWith('.zip')){
    logger.error('files should be in a zip !');
    promise.resolve(false);
    return;
  }
  try{
    target = campaign.name.replace(/\s/, '').toLowerCase();
    target += '.zip';
    request(campaign.uri).pipe(unzip.Extract({path: self.records.parent}));//fs.createWriteStream(path.join(self.records.parent, target)));
    promise.resolve(true);
  }
  catch(err){
    logger.error('Unable to fetch files for ' + campaign.uri + ' error : ' + err);
    promise.resolve(false);
  }
  return promise;
}

AutoVerifier.prototype.end = function() {
  var self = this;
  self.started_ = false;
  /*rimraf(self.records.parent, function(err){
    if(err)
      logger.error('Unable to rmdir ' + self.records.parent + ' error : ' + err);
    self.emit('ended');
  });*/
}
