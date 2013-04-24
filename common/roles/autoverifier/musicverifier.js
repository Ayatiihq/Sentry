/*
 * Musicverifier.js: 
 * (C) 2013 Ayatii Limited
 * Uses AcousticID's chromaprint to generate two fingerprints and then simply compares both.
 * Those to be seen to report a similarity score from .2->.9x are usually a match.
 * Have yet to come across a high scoring match (i.e one with 1-9/10 score) which is not a match.
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
  , exec = require('child_process').execFile
  , URI = require('URIjs')    
  ;

var logger = acquire('logger').forFile('musicverifier.js')
  , config = acquire('config')
  , states = acquire('states').infringements.state  
  ;

var MATCHER_THRESHOLD = 0.3;

var MusicVerifier = module.exports = function() {
  this.init();
}

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.tmpDirectory = null;
  self.results = {complete: [], incomplete: []};
  self.on('campaign-audio-ready', self.prepInfringement.bind(self));
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
  try{
    var r = request(downloadURL).pipe(downloadFile);  
    downloadFile.on('end', function () {
      logger.info("Download of " + downloadURL + " complete.")
      promise.resolve(true);
    });  
    downloadFile.on('error', function (err) {
      logger.warn(err, 'error downloading ' + downloadURL);
      promise.resolve(false);
    });
    downloadFile.on('close', function (err){
      logger.warn(err, 'Connection closed ' + downloadURL);
      promise.resolve(false);      
    });
    downloadFile.on('complete', function (err){
      logger.warn(err, 'Connection completed ' + downloadURL);
      promise.resolve(false);      
    });
  }
  catch(err){
    logger.warn('Error requesting ' + downloadURL + ' err : ' + err);
    promise.resolve(false);
  }  
}

MusicVerifier.prototype.fetchInfringement = function(){
  var self = this;
  var promise = new Promise.Promise();
  try{
    logger.info('Fetch infringement : ' + self.infringement.uri);
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
  var wrapperPromise = new Promise.Promise();

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
    wrapperPromise.resolve();
  }); 
  return wrapperPromise; 
}

MusicVerifier.prototype.evaluate = function(track, promise){
  var self = this;
  logger.info('about to evaluate ' + track.folderPath);
  exec(path.join(process.cwd(), 'bin', 'fpeval'), [track.folderPath],
    function (error, stdout, stderr){
      if(stderr && !stderr.match(/Header\smissing/g))
        logger.error("Fpeval standard error : " + stderr);
      if(error && !stderr.match(/Header\smissing/g))
        logger.warn("warning running Fpeval: " + error);                    
      
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
  var err = null;

  self.campaign.metadata.tracks.each(function(track){
    if(track.score > MATCHER_THRESHOLD){ 
      if(!matchedTracks.isEmpty()){
        var score =  matchedTracks[0].score;
        logger.error("Music Verifier has found two potential matches for one infringement in the same album - other score = " + score + ' and this score : ' + track.score);
      }
      else{
        matchedTracks.push(track);
      }
    }
  });
  
  var verificationObject = {started : self.startedAt,
                            who : "MusicVerifer AKA Harry Caul",
                            finished : Date.now()
                           };


  var success = matchedTracks.length === 1;
  if(success){
    logger.info('Successfull matching ' + self.infringement.uri);
    verificationObject = Object.merge (verificationObject, 
                                      {"state" : states.VERIFIED,
                                       "notes" : "Harry Caul is happy to report that this is verified against : " + matchedTracks[0].title});
    self.results.complete.push(verificationObject);
  }
  else{
    
    verificationObject.state = states.FALSE_POSITIVE

    if(matchedTracks.length > 1){
      verificationObject.notes = "Harry Caul found more than one match here, please examine infringement, matched tracks are : " + JSON.stringify(matchedTracks.map(function(tr){return tr.title}));
      err = 'Hmm matched two originals against an infringement on a given campaign : ' + JSON.stringify(matchedTracks);
    }
    else{ //matchedTracks.length === 0
      verificationObject.notes = "Harry Caul did not find any match, again please examine.",
      logger.info('Not successful in matching ' + self.infringement.uri);
    }
    self.results.incomplete.push(verificationObject);    
  }

  // Reset infringements
  self.results = {complete: [], incomplete: []};

  self.done(err, verificationObject);
}

MusicVerifier.prototype.prepInfringementList = function (infrgs){
  var self = this;
  var promiseArray = infrgs.map(function(infrg) { return self.oneAtaTime.bind(self, infrg)});
  Promise.seq(promiseArray).then(function(){
    logger.info('Finished verifying list : matched successfully : ' + self.results.completed.length);
    logger.info('Failed to match: ' + self.results.incomplete.length);
    fs.writeFile(path.join(process.cwd(),'musicverifierResults'),
                 JSON.stringify(self.results), function(err) {if(err)logger.warn('Couldnt write to results file')}); 
    self.cleanupEverything();
  }); 
}

MusicVerifier.prototype.prepInfringement = function (){
  logger.info('campaign audio ready - get the infringement');
  var self = this;
  self.fetchInfringement().then(function(success){
    if(success)
      self.goFingerprint(); // got everything in place, lets match.
    else
      done('Problem fetching infringment');
  });        
}

MusicVerifier.prototype.oneAtaTime = function(infrg){
  var self = this;
  var promise = new Promise.Promise();
  try{ // don't bother with uris that have not been completed.
    var link = URI(infrg.uri);
    if(link.is('relative')){
      logger.info('uri is relative - dont go any further' + ' : ' + infrg.uri);
      promise.resolve();
      return promise;
    }
  } 
  catch(err){
    promise.resolve();
    logger.info('error making uri from link' +  ' : ' + err );
    return promise;
  }
  self.infringement = infrg;
  self.fetchInfringement().then(function(success){
    if(success) {
      self.goFingerprint().then(function(){
        promise.resolve();
      });   
    }
    else{
      promise.resolve();
    }
  });
  return promise;
}

MusicVerifier.prototype.cleanupEverything = function(err) {
  var self = this;
  logger.info('cleanupEverything');  

  self.results = {complete: [], incomplete: []};

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
  var sameCampaignAsBefore = self.campaign &&
                             (self.campaign._id.client === campaign._id.client &&
                             self.campaign._id.campaign === campaign._id.campaign);

  // Call this as (err, verificationObject) when either is ready
  self.done = done;
  self.infringement = infringement;
  self.startedAt = Date.now();

  logger.info('Trying autoverification for %s', infringement.uri);

  if(!sameCampaignAsBefore){
    // if we had a different previous campaign, nuke it.
    if(self.campaign)self.cleanupEverything();

    self.campaign = campaign;
    var promise = self.createParentFolder(campaign);
    promise.then(function(err){
      if(err){
        self.cleanupEverything(err);
        return;
      }
      self.fetchCampaignAudio();
    });
  }
  else{ // Same campaign as before
    logger.info("we just processed that campaign, use what has already been downloaded.")
    self.emit('campaign-audio-ready');
  }
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
  self.on('campaign-audio-ready', self.prepInfringementList.bind(self, infringementList));
}

MusicVerifier.prototype.finish = function(){
  if(self.tmpDirectory) {
    self.cleanupEverything();
    self.tmpDirectory = null;
  }
}