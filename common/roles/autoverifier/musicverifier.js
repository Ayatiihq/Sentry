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
  , fs = require('fs')
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

MusicVerifier.prototype.fetchFiles = function() {
  var self = this;

  function fetchTrack(track){
    var self = this;
    var promise = new Promise.Promise();
    var folderName = self.createRandomName("");
    var trackPath = path.join(self.tmpDirectory, folderName);
    try{
      fs.mkdirSync(trackPath);
      self.downloadThing(track.uri, path.join(trackPath, "original"), promise);
      track.folderPath = trackPath;
      track.score = 0.0;
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
    self.fetchInfringement().then(function(success){
      if(!success)
        self.cleanup();
      else
        self.goFingerprint();
    });
  }); 
}

MusicVerifier.prototype.downloadThing = function(downloadURL, target, promise){
  var self = this;
  var downloadFile = filed(target);  
  var r = request(downloadURL).pipe(downloadFile);  
  downloadFile.on('end', function () {
    logger.info("Download of " + downloadURL + " complete.")
    promise.resolve(true);
  });  
  downloadFile.on('error', function (err) {
    logger.warn(err, 'error downloading ' + downloadURL);
    promise.resolve(false);
  });  
}

MusicVerifier.prototype.fetchInfringement = function(){
  var self = this;
  var promise = new Promise.Promise();
  try{
    self.downloadThing(self.infringement.uri, path.join(self.tmpDirectory, "infringement"), promise);
  }
  catch(err){
    logger.warn('Problem fetching infringing file : err : ' + err);
    promise.resolve(false);
  }
  return promise;
}

MusicVerifier.prototype.goFingerprint = function(){
  var self = this;

  var copyfile = function (source, target, cb) {
    logger.info("Begin copying files : " + source + " to " + target);
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
        logger.error("Error running Fpeval: " + error);                    
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
    if(track.score > 0.6){ //Re-evaluate this threshold I think it could be higher
      if(!matchedTracks.isEmpty()){
        logger.error("Music Verifier has found two potential matches for one infringement in the same album - other score = " + matchedTrack.score + ' and this score : ' + track.score);
      }
      else{
        matchedTracks.push(track);
      }
    }
  });

  if(matchedTracks.length === 1){
    console.log('here is the match ' + matchedTracks[0].folderPath);
    // TODO emit
    /*{
      "state" : 2,
      "notes" : "Harry Caul is happy to report that this is verified.",
      "who" : "MusicVerifer AKA Harry Caul",
      "started" : Date.now(),
      "finished" : Date.now(),
      "created" : Date.now()
    }*/    
  }
  else{
    if(matchedTracks.length > 1){
      logger.error('Hmm matched two originals against an infringement on a given campaign : ' + JSON.stringify(matchedTracks));
    }
    else{ //matchedTracks.length === 0
      logger.info('Not successfull in matching ' + self.infringement.uri);
    }
  }
}

MusicVerifier.prototype.cleanup = function() {
  var self = this;
  logger.info('cleanup');  
  rimraf(self.tmpDirectory, function(err){
    if(err)
      logger.error('Unable to rmdir ' + self.tmpDirectory + ' error : ' + err);
    self.emit('ended');
  });
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
      self.cleanup();
      return;
    }
    self.fetchFiles();
  });
}
