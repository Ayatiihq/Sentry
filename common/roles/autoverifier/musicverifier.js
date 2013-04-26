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
  , utilities = acquire('utilities') 
  ;

var logger = acquire('logger').forFile('musicverifier.js')
  , config = acquire('config')
  , states = acquire('states').infringements.state  
  ;

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

MusicVerifier.prototype.createParentFolder = function() {
  var self = this;
  var promise = new Promise.Promise();

  self.tmpDirectory = path.join(os.tmpDir(), utilities.genLinkKey(self.campaign.name)); 
  self.cleanupEverything().then(function(){
    logger.info('creating parent folder ' + self.tmpDirectory);
    fs.mkdir(self.tmpDirectory, function(err){
      if(err)
        logger.error('Error creating parenting folder called ' + self.tmpDirectory);
      promise.resolve(err);
    });    
  });// Call this just in case we have a hangover from some other failed run on the same campaign
  return promise;
}

MusicVerifier.prototype.fetchCampaignAudio = function() {
  var self = this;

  function fetchTrack(track){
    var self = this;
    var promise = new Promise.Promise();
    var folderName = utilities.genLinkKey(track.title);
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
    var req = request(downloadURL);
    req.pipe(downloadFile);  

    req.on('error', function(err) {
      logger.warn(err, 'error downloading ' + downloadURL);
      promise.resolve(false);
    });
    req.on('close', function(err) {
      logger.warn(err, 'Connection closed ' + downloadURL);
      promise.resolve(false);
    });
    req.on('complete', function(err) {
      logger.warn(err, 'Connection completed ' + downloadURL);
      promise.resolve(false);
    });

    downloadFile.on('end', function () {
      logger.info("Download of " + downloadURL + " complete.")
      promise.resolve(true);
    });  
    downloadFile.on('error', function (err) {
      logger.warn(err, 'error downloading ' + downloadURL);
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
              }
              else{
                self.evaluate(track, promise);
              }
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
        track.score = -1;// -1 signifying fpeval failed for some reason.
      }
      promise.resolve();
    });
}

MusicVerifier.prototype.examineResults = function(){
  var self = this;
  var matchedTracks = [];
  var err = null;
  var MATCHER_THRESHOLD = 0.3;

  // First check that fpeval could carry out a match, if not end this check with an error
  var failedEvaluation = self.campaign.metadata.tracks.map(function(track){ return track.score < 0}).unique();
  if(failedEvaluation.length === 1 && failedEvaluation.first() === true){
    logger.warn('Failed to match with FPeval, more than likely an issue with downloading the infringment');
    self.done(new Error('FpEval failed to carry out any match'));
    return;
  }

  self.campaign.metadata.tracks.each(function(track){
    if(track.score > MATCHER_THRESHOLD){ 
      if(!matchedTracks.isEmpty())
        logger.warn("Music Verifier has found two potential matches for one infringement in the same album - other score = " + 
                     matchedTracks.last().score + ' and this score : ' + track.score + " for uri : " + infringment.uri);
      matchedTracks.push(track);
    }
  });
  
  var verificationObject = {started : self.startedAt,
                            who : "MusicVerifer AKA Harry Caul",
                            finished : Date.now()
                           };
  
  var success;

  if(matchedTracks.length > 1){
    var delta = matchedTracks.reduce(function(a, b){
      return a-b;
    });
    logger.warn('We found ' + matchedTracks.length + ' matches and the delta between them is ' + delta);
    success = delta > 0.2;
  }
  else{
    success = matchedTracks.length === 1 // this needs more testing.
  }

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
      self.done('Problem fetching infringment');
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
  var promise = new Promise.Promise();
  logger.info('cleanupEverything');  

  rimraf(self.tmpDirectory, function(err){
    if(err){
      logger.warn('Unable to rmdir ' + self.tmpDirectory + ' error : ' + err);
    }
    promise.resolve();
  });
  return promise;
}

MusicVerifier.prototype.cleanupInfringement = function() {
  var self = this;
  var wrapperPromise = new Promise.Promise();

  var deleteInfringement = function(dir) {
    var promise = new Promise.Promise();
    if(!dir){
      promise.resolve();
    }
    else{
      var matched = false;
      fs.readdir(dir, function(err, files){
        if(err){
          promise.resolve();
          return;
        }
        files.each(function(file){
          if(file.match(/infringement/g)){
            fs.unlink(path.join(dir, file), function (errr) {
              if (errr)
                logger.warn('error deleting ' + errr + path.join(dir, file));
            });
            matched = true;
            promise.resolve();                    
          }
        });
        // Make sure to resolve the mother even it there isn't a match (failed download or whatever)
        if(!matched) promise.resolve();
      });
    }
    return promise
  }

  if(self.campaign){
    var promiseArray;
    promiseArray = self.campaign.metadata.tracks.map(function(track){ return deleteInfringement.bind(self, track.folderPath)});
    promiseArray.push(deleteInfringement.bind(self, self.tmpDirectory));

    Promise.seq(promiseArray).then(function(){
      wrapperPromise.resolve()
    }); 
  }
  else{
    wrapperPromise.resolve();
  }
  return wrapperPromise;
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

MusicVerifier.prototype.verify = function(campaign, infringement, done){
  var self = this;
  var haveRunAlready = !!self.campaign;

  var sameCampaignAsBefore = self.campaign &&
                             (self.campaign._id.client === campaign._id.client &&
                              self.campaign._id.campaign === campaign._id.campaign);

  self.done = done;
  self.infringement = infringement;
  self.startedAt = Date.now();

  logger.info('Trying music verification for %s', infringement.uri);
  self.cleanupInfringement().then(function(){    
    if(!sameCampaignAsBefore){
      // if we had a different previous campaign, nuke it.
      var cleansing;

      if(haveRunAlready){
        cleansing = self.cleanupEverything();
      }
      else{
        cleansing  = new Promise.Promise();
        cleansing.resolve();
      }

      cleansing.then(function(){
        // Only on a new campaign do we overwrite our instance variable
        // (We want to still know about folderpaths etc.)
        self.campaign = campaign; 

        var promise = self.createParentFolder();
        promise.then(function(err){
          if(err){
            self.cleanupEverything().then(function(){
              self.done(err);
              return;              
            });
          }
          else{
            self.fetchCampaignAudio();
          }
        });
      });
    }
    else{ // Same campaign as before, keep our one in memory
      logger.info("we just processed that campaign, use what has already been downloaded.")
      self.campaign.metadata.tracks.each(function resetScore(track){
        track.score = 0.0;
      });      
      self.emit('campaign-audio-ready');
    }
  });
}


MusicVerifier.prototype.verifyList = function(campaign, infringementList, done) {
  var self = this;
  self.done = done;
  self.campaign = campaign;
  self.startedAt = Date.now();
  self.createParentFolder().then(function(err){
    if(err){
      self.cleanupEverything();
      self.done(err);
      return;
    }
    self.fetchCampaignAudio();
  });  
  self.on('campaign-audio-ready', self.prepInfringementList.bind(self, infringementList));
}

MusicVerifier.prototype.finish = function(){
  if(self.tmpDirectory) {
    self.cleanupEverything().then(function(){
      self.tmpDirectory = null;
    });
  }
}