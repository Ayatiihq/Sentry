/*
 * Autoverifier.js: the awesome MusicVerifier
 * (C) 2013 Ayatii Limited
 * MusicVerifier processes infringements that need downloading and attempts to autoverify them depending on the campaign type. 
 */
var acquire = require('acquire')
  , Seq = require('seq')
  , events = require('events')
  , util = require('util')
  , fs = require('fs')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  ;

var logger = acquire('logger').forFile('musicverifier.js')
  , config = acquire('config')
  , states = acquire('states')  
  ;

var MusicVerifier = module.exports = function() {
  this.init();
}

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.records = {};
}


MusicVerifier.prototype.createRandomName = function(handle) {
  return [handle.replace(/\s|(|)|:/,"").toLowerCase(),
          '-',
          Date.now(),
          '-',
          process.pid,
          '-',
          (Math.random() * 0x100000000 + 1).toString(36)].join('');
}

MusicVerifier.prototype.createParentFolder = function(campaign) {
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
MusicVerifier.prototype.fetchFiles = function() {
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

MusicVerifier.prototype.goFingerprint = function(){
  var self = this;
  logger.info("Begin comparing files");
  self.end();
}

//
// Public
//

// This needs to not be added to the prototype, that way it's available without
// having to make an instance of the verifier
MusicVerifier.getSupportedTypes = function() {
  return [
    , 'audio/mpeg'
    , 'audio/mpeg3'
    , 'audio/mp3'
    , 'audio/x-mpeg-3'
  ];
}

MusicVerifier.prototype.verify = function(campaign, infringement, done) {
  var self = this;

  logger.info('Trying autoverification for %s', infringement.uri);

  // Call this as (err, verificationObject) when either is ready
  self.done_ = done;
  self.campaign = campaign;
  self.infringement = infringement;

  var promise = self.createParentFolder(campaign);
  promise.then(function(err){
    if(err){
      self.end();
      return;
    }
    self.fetchFiles();
  });
}
