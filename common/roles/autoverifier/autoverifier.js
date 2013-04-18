/*
 * Autoverifier.js: the awesome AutoVerifier
 * (C) 2013 Ayatii Limited
 * AutoVerifier processes infringements that need downloading and attempts to autoverify them depending on the campaign type. 
 */
var acquire = require('acquire')
  , Seq = require('seq')
  , events = require('events')
  , util = require('util')
  , fs = require('fs')
  , os = require('os')
  , Promise = require('node-promise')
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
  , logger = acquire('logger').forFile('verifier.js')
  , config = acquire('config')
  , states = acquire('states')  
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
  self.campaign = null;
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
  self.campaign = campaign;
  var promise = self.createParentFolder(campaign);
  promise.then(function(err){
    if(err){
      self.end();
      return;
    }
    self.fetchFiles();
  });
}
  
AutoVerifier.prototype.createRandomName = function(handle) {
  return [handle.replace(/\s|(|)|:/,"").toLowerCase(),
          '-',
          Date.now(),
          '-',
          process.pid,
          '-',
          (Math.random() * 0x100000000 + 1).toString(36)].join('');
}

AutoVerifier.prototype.createParentFolder = function(campaign) {
  var self = this;
  var promise = new Promise.Promise();
  self.records.parent = path.join(os.tmpDir(), self.createRandomName(campaign.name)); 
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
AutoVerifier.prototype.fetchFiles = function() {
  var self = this;

  function fetchTrack(track){
    var self = this;
    var promise = new Promise.Promise();
    var folderName = self.createRandomName("");
    var trackPath = path.join(self.records.parent, folderName);
    try{
      fs.mkdirSync(trackPath);
      request(track.uri).pipe(fs.createWriteStream(path.join(trackPath, "original.mp3")));
      track.folderPath = trackPath;
      promise.resolve(true);
    }
    catch(err){
      logger.error('Unable to fetch file for ' + track.title + ' error : ' + err);
      promise.resolve(false);
    }
    return promise;
  }

  var promiseArray;
  promiseArray = self.campaign.metadata.tracks.map(function(track){ return fetchTrack.bind(self, track)});
  Promise.seq(promiseArray).then(function(){
    self.goFingerprint();
  }); 
}

AutoVerifier.prototype.goFingerprint = function(){
  var self = this;
  logger.info("Begin comparing files");
  self.end();
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
