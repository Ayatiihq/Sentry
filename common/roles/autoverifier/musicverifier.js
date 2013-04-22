/*
 * Autoverifier.js: the awesome MusicVerifier
 * (C) 2013 Ayatii Limited
 * MusicVerifier processes infringements that need downloading and attempts to autoverify them depending on the campaign type. 
 */
var acquire = require('acquire')
  , Seq = require('seq')
  , events = require('events')
  , util = require('util')
  , filed = require('filed')  
  , fs = require('fs-extra')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , rimraf = require('rimraf')
  , exec = require('child_process').execFile;  
  ;

var logger = acquire('logger').forFile('musicverifier.js')
  , config = acquire('config')
  , states = acquire('states')  
  ;

var MusicVerifier = module.exports = function() {
  this.init();

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }

}

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.tmpDirectory = null;
}

MusicVerifier.prototype.createRandomName = function(handle) {
  return [handle.replace(/\s/,"").toLowerCase(),
          Date.now(),
          process.pid,
          (Math.random() * 0x100000000 + 1).toString(36)].join('');
}

MusicVerifier.prototype.createParentFolder = function(campaign) {
  var self = this;
  var promise = new Promise.Promise();
  self.tmpDirectory = path.join(os.tmpDir(), self.createRandomName(campaign.name)); 
  fs.mkdir(self.tmpDirectory, function(err){
    if(err)
      logger.error('Error creating parenting folder called ' + self.tmpDirectory);
    promise.resolve(err);
  });
  return promise;
}

MusicVerifier.prototype.fetchCampaignAudio = function() {
  var self = this;

  function fetchTrack(track){
    var self = this;
    var promise = new Promise.Promise();
    var folderName = self.createRandomName("");
    track.folderPath = path.join(self.tmpDirectory, folderName);
    track.score = 0.0;
    try{
      fs.mkdirSync(track.folderPath);
      self.downloadThing(track.uri, path.join(track.folderPath, "original"), promise);
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
    self.emit('campaign-audio-ready');
  }); 
}

MusicVerifier.prototype.downloadThing = function(downloadURL, target, promise){
  var self = this;
  var downloadFile = filed(target);  
  var r = request(downloadURL).pipe(downloadFile);  
  downloadFile.on('end', function () {
    if(target.has('infringement'))
      self.emit('infringment-ready');
    logger.info("Download of " + downloadURL + " complete.")
    promise.resolve(true);
  });  
  downloadFile.on('error', function (err) {
    logger.warn(err, 'error downloading ' + downloadURL);
    promise.resolve(false);
  });  
}

MusicVerifier.prototype.fetchInfringement = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  try{
    self.downloadThing(infringement || self.infringement.uri, path.join(self.tmpDirectory, "infringement"), promise);
  }
  catch(err){
    logger.warn('Problem fetching infringing file : err : ' + err);
    self.cleanupEverything(err);
    promise.resolve(false);
  }
  return promise;
}

MusicVerifier.prototype.goFingerprint = function(){
  var self = this;

  var copyfile = function (source, target, cb) {
    var cbCalled = false;
    var rd = fs.createReadStream(source);
    rd.on("error", function(err) {
      done(err);
    });
    var wr = fs.createWriteStream(target);
    wr.on("error", function(err) {
      done(err);
    });
    wr.on("close", function(ex) {
      done();
    });
    rd.pipe(wr);
    function done(err) {
      if (!cbCalled) {
        cb(err);
        cbCalled = true;
      }
    }
  };

  var compare = function(track){
    var self = this;
    var promise = new Promise.Promise();
    copyfile(path.join(self.tmpDirectory,  'infringement'),
             path.join(track.folderPath, 'infringement'),
             function(err){
              if(err){
                logger.error('Error copying file : ' + err);
                promise.resolve();
                return;
              }
              self.evaluate(track, promise);
             });
    return promise;
  }

  var promiseArray;
  promiseArray = self.campaign.metadata.tracks.map(function(track){return compare.bind(self, track)});

  Promise.seq(promiseArray).then(function(){
    self.examineResults();
  });  
}

MusicVerifier.prototype.evaluate = function(track, promise){
  var self = this;
  exec(path.join(process.cwd(), 'bin', 'fpeval'), [track.folderPath],
    function (error, stdout, stderr){
      if(stderr)
        logger.error("Fpeval standard error : " + stderr);
      if(error)
        logger.warn("Error running Fpeval: " + error);                    
      try{ // Try it anyway (sometimes errors are seen with headers but FFMPEG should be able to handle it)
        var result = JSON.parse(stdout);
        logger.info('Track : ' + track.title + '-  result : ' + JSON.stringify(result));
        track.score = result.score;
      }
      catch(err){
        logger.error("Error parsing FPEval output" + err);
      }
      promise.resolve();
    });
}

MusicVerifier.prototype.examineResults = function(){
  var self = this;
  var matchedTracks = [];
  self.campaign.metadata.tracks.each(function(track){
    if(track.score > 0.3){ 
      if(!matchedTracks.isEmpty()){
        var score =  matchedTracks[0].score;
        logger.error("Music Verifier has found two potential matches for one infringement in the same album - other score = " + score + ' and this score : ' + track.score);
      }
      else{
        matchedTracks.push(track);
      }
    }
  });
  
  var verificationObject;

  if(matchedTracks.length === 1){
    verificationObject = {"state" : 1,//verified
                          "notes" : "Harry Caul is happy to report that this is verified.",
                          "who" : "MusicVerifer AKA Harry Caul",
                          "started" : self.startedAt,
                          "finished" : Date.now(),
                          "created" : Date.now()}
       
  }
  else{
    verificationObject = {"state" : 2,// False positive
                          "who" : "MusicVerifer AKA Harry Caul",
                          "started" : self.startedAt,
                          "finished" : Date.now(),
                          "created" : Date.now()}

    if(matchedTracks.length > 1){
      verificationObject.notes = "Harry Caul found more than one match here, please examine infringement",
      logger.error('Hmm matched two originals against an infringement on a given campaign : ' + JSON.stringify(matchedTracks));
    }
    else{ //matchedTracks.length === 0
      verificationObject.notes = "Harry Caul did not find any match, again please examine.",
      logger.info('Not successfull in matching ' + self.infringement.uri);
    }
  }
  self.emit('finished');
  self.done(null, verificationObject);
}

MusicVerifier.prototype.cleanupEverything = function(err) {
  var self = this;
  logger.info('cleanupEverything');  
  rimraf(self.tmpDirectory, function(err){
    if(err)
      logger.error('Unable to rmdir ' + self.tmpDirectory + ' error : ' + err);
  });
  // Only call in this context if we pass an error.
  if(err){
    logger.warn('musicverifier ending with an error : ' + err);
    self.done(err);
  }
}

MusicVerifier.prototype.cleanupInfringement = function() {
  var self = this;
  var walker = fs.walk(self.tmpDirectory);
  var promise = new Promise.Promise();
  // file, files, directory, directories
  walker.on("file", function (root, stat, next) {
    if(stat.name.match(/infringement/g)){
      fs.removeSync(path.join(root, stat.name))
      logger.info('Just deleted', path.join(root, stat.name));
    }
    if(!next)
      promise.resolve();
  });
  return promise;
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
  self.done = done;
  self.campaign = campaign;
  self.infringement = infringement;
  self.startedAt = Date.now();

  var promise = self.createParentFolder(campaign);
  promise.then(function(err){
    if(err){
      self.cleanupEverything(err);
      return;
    }
    self.fetchCampaignAudio();
  });

  function prepInfringement(){
    var self = this;
    self.fetchInfringement().then(function(success){
      if(success)
        self.goFingerprint(); // got everything in place, lets match.
    });        
  }

  self.on('campaign-audio-ready', self.prepInfringement.bind(self));
  self.on('finished', self.cleanupEverything.bind(self, null));
}

MusicVerifier.prototype.verifyList = function(campaign, infringementList, done) {
  var self = this;

  self.done = done;
  self.campaign = campaign;
  self.startedAt = Date.now();

  self.createParentFolder(campaign).then(function(err){
    if(err){
      self.cleanupEverything(err);
      return;
    }
    self.fetchCampaignAudio();
  });  

  function goCompare(infrgs){
    var that = this;
    infrgs.each(function(infrg){
      that.fetchInfringement(infrg.uri).then(function(success){
        if(success) that.goFingerprint();   
      });
    });
  }
  self.on('campaign-audio-ready', goCompare.bind(self, infringementList));
}
