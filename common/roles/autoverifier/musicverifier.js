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
  , fs = require('fs-extra')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , rimraf = require('rimraf')
  , exec = require('child_process').execFile
  , URI = require('URIjs')   
  , utilities = acquire('utilities') 
  , Downloads = acquire('downloads')
  ;

var logger = acquire('logger').forFile('musicverifier.js')
  , config = acquire('config')
  , states = acquire('states').infringements.state
  ;

var Storage = acquire('storage');

var MusicVerifier = module.exports = function() {
  this.init();
}

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.tmpDirectory = null;
  self.storage = new Storage('downloads');
}

MusicVerifier.prototype.createParentFolder = function(){
  var self = this;
  var promise = new Promise.Promise();
  self.tmpDirectory = path.join(os.tmpDir(), utilities.genLinkKey(self.campaign.name)); 
  self.cleanupEverything().then(function(){
    logger.info('%s: creating parent folder %s', self.infringement._id, self.tmpDirectory);
    fs.mkdir(self.tmpDirectory, function(err){
      if(err){
        logger.error('%s: Error creating parenting folder called %s', self.infringement._id, self.tmpDirectory);
        promise.reject(err);
        return;
      }
      promise.resolve();
    });    
  });// Call this just in case we have a hangover from some other failed run on the same campaign
  return promise;
}

MusicVerifier.prototype.downloadThing = function(downloadURL, target){
  var self = this;
  var promise = new Promise.Promise();
  var out = fs.createWriteStream(target);
  //logger.info('downloadThing ' + downloadURL);

  utilities.requestStream(downloadURL, {}, function(err, req, res, stream){
    if(err){
      logger.error('unable to downloadThing ' + downloadURL + ' error : ' + err);
      promise.reject(err);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + downloadURL);
      promise.resolve();
    });
  });
  return promise;
}

/*
 * This method might seem a little long-winded but for the sake of accurate note taking its layed out this way.
 * @return {[error, verificationObject]} 
 */
MusicVerifier.prototype.examineResults = function(){
  var self = this;
  var matchedTracks = [];
  var err = null;
  var MATCHER_THRESHOLD = 0.3;

  var verificationObject = {started : self.startedAt,
                            who : "MusicVerifer AKA Harry Caul",
                            finished : Date.now()
                           };

  // First check that fpeval could carry out a match, if any of the match attempts fail (score === -1) then return with error.
  var failedEvaluation = self.campaign.metadata.tracks.map(function(track){ return track.score < 0}).unique();
  if(failedEvaluation.length === 1 && failedEvaluation.first() === true){
    logger.warn(self.infringement._id + ': Failed to match with FPeval, more than likely an issue with downloading the infringment');
    return [new Error('FpEval failed to carry out any match'), verificationObject];
  }

  // Next attempt to filter which tracks have a score above the MATCHER_THRESHOLD
  self.campaign.metadata.tracks.each(function(track){
    if(track.score > MATCHER_THRESHOLD){ 
      if(!matchedTracks.isEmpty())
        logger.warn(self.infringement._id + ": Music Verifier has found two potential matches for one infringement in the same album - other score = " + 
                     matchedTracks.last().score + ' and this score : ' + track.score + " for uri : " + self.infringement.uri);
      matchedTracks.push(track);
    }
  });
  
  var success;

  // At this point if we have more than 1 track which matched successfully we want to make sure the delta between the scores
  // is greater than 0.2 inorder to be confident that we have a genuine match. Deltas which are less than 0.2 indicate a very
  // inaccurate and fuzzy resultset => mark unsuccessfull
  if(matchedTracks.length > 1){
    var delta = matchedTracks.reduce(function(a, b){
      return a-b;
    });
    logger.warn(self.infringement._id + ': We found ' + matchedTracks.length + ' matches and the delta between them is ' + delta);
    success = delta > 0.2;
    if(success){
      verificationObject = Object.merge (verificationObject,
                                        {"state" : states.VERIFIED,
                                         "notes" : "Success but Harry Caul found more than one match where the delta between the matches was > 0.2, please examine infringement, matched tracks are : " + JSON.stringify(matchedTracks.map(function(tr){return tr.title}))});
    }
    else{
      verificationObject.state = states.FALSE_POSITIVE
      verificationObject.notes = "Harry Caul found more than one match where the delta between the matches was < 0.2, please examine infringement, matched tracks are : " + JSON.stringify(matchedTracks.map(function(tr){return tr.title}));
      err = new Error('Hmm matched two originals against an infringement on a given campaign : ' + JSON.stringify(matchedTracks));      
    }
  }
  else{ // Else just check for the simple lone match. Write up notes accordingly
    success = matchedTracks.length === 1; 
    if(success){
      verificationObject = Object.merge (verificationObject, 
                                        {"state" : states.VERIFIED,
                                         "notes" : "Harry Caul is happy to report that this is verified against : " + matchedTracks[0].title});
    }
    else{
      verificationObject.state = states.FALSE_POSITIVE;
      verificationObject.notes = "Harry Caul did not find any match, please examine.";
    }
  }
  return[err, verificationObject];
}

MusicVerifier.prototype.cleanupEverything = function() {
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

/*
 * Attempt to clean the file called infringement from each track folder
 */
MusicVerifier.prototype.cleanupInfringement = function() {
  var self = this;
  var wrapperPromise = new Promise.Promise();

  function deleteInfringement(dir) {
    var promise = new Promise.Promise();
    fs.readdir(dir, function(err, files){
      if(err){
        promise.reject(err);
        return;
      }
      var matched = false;
      files.each(function(file){
        if(file.match(/infringement/g)){
          matched = true;
          fs.unlink(path.join(dir, file), function (errr) {
            if(errr){
              logger.warn('error deleting ' + errr + path.join(dir, file));
              promise.reject(errr);
              return;              
            }
            promise.resolve();
          });
        }
      });
      // Make sure to resolve the mother even if there isn't a match (failed download or whatever)
      if(!matched)promise.resolve();
    });
    return promise
  }

  var promiseArray;
  promiseArray = self.campaign.metadata.tracks.map(function(track){ if(track.folderPath) return deleteInfringement.bind(self, track.folderPath)});
  Promise.seq(promiseArray).then(function(){
    logger.info('Finished deleting infringement from track folders...')
    wrapperPromise.resolve();
  },
  function(err){
    wrapperPromise.reject(err);   
  });   
  return wrapperPromise;
}

/* 
 * Go through each track for that campaign, create a folder for it.
 * download it to that location, error if there is ANY error.
 */
MusicVerifier.prototype.fetchCampaignAudio = function(done) {
  var self = this;

  function fetchTrack(track){
    var promise = new Promise.Promise();
    var folderName = utilities.genLinkKey(track.title);
    track.folderPath = path.join(self.tmpDirectory, folderName);
    track.score = 0.0;
    fs.mkdirSync(track.folderPath);
    self.downloadThing(track.uri, path.join(track.folderPath, "original")).then(
      function(){
        promise.resolve();
      },
      function(err){
        logger.error(self.infringement._id + ': Unable to fetch file for ' + track.title + ' error : ' + err);
        promise.reject(err);
      }
    );
    return promise;
  }

  var promiseArray;
  promiseArray = self.campaign.metadata.tracks.map(function(track){ return fetchTrack.bind(self, track)});
  Promise.seq(promiseArray).then(function(){
    done();
  },
  function(err){
    done(err)
  }); 
}

MusicVerifier.prototype.newCampaignChangeOver = function(haveRunAlready, campaign, done){
  // if we had a different previous campaign, nuke it.
  var self = this; 
  var cleansing;

  if(haveRunAlready){
    cleansing = self.cleanupEverything();
  }
  else{
    cleansing  = new Promise.Promise();
    cleansing.resolve();
  }

  cleansing.then(function(){
    // Only on a new campaign do we overwrite 
    // (We want to still know about folderpaths etc.)
    self.campaign = campaign; 

    self.createParentFolder().then(function(){
      self.fetchCampaignAudio(done);
    },
    function(err){
      self.done(err);
    });
  });
}

MusicVerifier.prototype.prepCampaign = function(campaign, done){
  var self = this;

  var sameCampaignAsBefore = self.campaign &&
                             (self.campaign._id.client === campaign._id.client &&
                              self.campaign._id.campaign === campaign._id.campaign);
  if(!sameCampaignAsBefore){
    logger.info()
    self.newCampaignChangeOver(!!self.campaign, campaign, done);
  }
  else{ // Same campaign as before, keep our one in memory but reset the track.score
    logger.info("we just processed that campaign, use what has already been downloaded.")
    self.campaign.metadata.tracks.each(function resetScore(track){
      track.score = 0.0;
    });      
    done();
  }
}

MusicVerifier.prototype.copyDownload = function(download, track){
  var promise = new Promise.Promise();
  fs.copy(download.tmpFileLocation,
          path.join(track.folderPath, 'infringement'),
          function(err){
            if(err){
              logger.error('Error copying file : ' + err);
              promise.reject(err);
              return;
            }
            promise.resolve();
          });
  return promise;
}

// TODO refactor somehow
MusicVerifier.prototype.goMeasureDownload = function(download, done){
  var self = this;

  function compare(track){
    var promise = new Promise.Promise();
    logger.info('about to evaluate ' + track.title + ' at ' + track.folderPath);
    exec(path.join(process.cwd(), 'bin', 'fpeval'), [track.folderPath],
      function (error, stdout, stderr){
        if(stderr && !stderr.match(/Header\smissing/g))
          logger.error(self.infringement._id + ": Fpeval standard error : " + stderr);
        if(error && !stderr.match(/Header\smissing/g))
          logger.warn(self.infringement._id + ": warning running Fpeval: " + error);                    
        
        try{ // Try it anyway (sometimes errors are seen with headers but FFMPEG should be able to handle it)
          var result = JSON.parse(stdout);
          logger.info('Track : ' + track.title + '-  result : ' + JSON.stringify(result));
          track.score = result.score;
        }
        catch(err){
          logger.error(self.infringement._id + ": Error parsing FPEval output (" + err + "): " + stdout + ':' + stderr);
          track.score = -1;// -1 signifying fpeval failed for some reason.
        }
        promise.resolve();
      });
    return promise;
  } 

  function doIt(track){
    var promise = new Promise.Promise();
    self.copyDownload(download, track).then(function(){
      compare(track).then(function(){
        promise.resolve();
      },
      function(err){
        promise.reject(err);
      });
    },
    function(err){
      promise.reject(err);
    });
    return promise;
  }

  var promiseArray;
  promiseArray = self.campaign.metadata.tracks.map(function(track){return doIt.bind(null, track)});
  Promise.seq(promiseArray).then(
    function(){
      var results = self.examineResults();
      if(results[0]){
        self.done(new Error('examine Results returned a nonsensical result'));
        return;
      }
      //if(true){//results[1].state === states.VERIFIED){
        // report back immediately once we are confident we have one match.
        logger.info('We have found a match ! - return immediately');
        self.done(null, results[1]);
      //}
      //else{ // Move on to the next track.
      //  done();
      //}
    },
    function(err){
      done(err);
    }
  );
}

/*
 * Fetch a download
 */
MusicVerifier.prototype.fetchDownload = function(download, done){
  var self = this;
  var uri = self.storage.getURL(download.name);
  var target = path.join(self.tmpDirectory, utilities.genLinkKey(download.name));
  download.tmpFileLocation = target;
  self.downloadThing(uri, target).then(
    function(){
      done();
    },
    function(err){
      logger.info(' Problem fetching the file : ' + err);
      done(err);
  });
}

//
// Public
//
MusicVerifier.prototype.verify = function(campaign, infringement, downloads, done){
  var self = this;
  self.done = done;
  self.infringement = infringement;
  self.startedAt = Date.now();

  logger.info(self.infringement._id + ': Trying music verification for %s', infringement.uri);

  self.prepCampaign(campaign, function(){
    Seq(downloads)
      .seqEach(function(download){
        var that = this;
        var isAudio = MusicVerifier.getSupportedTypes().some(download.mimetype);
        if(isAudio)
          logger.info('fetch Download ' + isAudio);
          self.fetchDownload(download, that);
        else
          that();
      })
      .seqEach(function(download){
        var that = this;
        if(download.tmpFileLocation){
          self.cleanupInfringement().then(function(){
            self.goMeasureDownload(download, that);      
          },
          function(err){
            logger.warn('Problem cleaning infringement %s', err);
            that();
          })
        }
        else
          that();// don't evaluate those that were not downloaded (not an audio file)        
      })
      .seq(function(){
        self.finish();
        logger.info('Finished multi-file verification...');
        self.done();
      })
      .catch(function(err) {
        logger.warn('Unable to process music-verification: %s', err);
      })    
    ;
  });
}

MusicVerifier.prototype.finish = function(){
  if(self.tmpDirectory) {
    self.cleanupEverything().then(function(){
      self.tmpDirectory = null;
    });
  }
}

// This needs to not be added to the prototype, that way it's available without
// having to make an instance of the verifier
// TODO test each of these formats against fpeval !
// ensure compatibility
MusicVerifier.getSupportedTypes = function() {
  return [
    , 'audio/mpeg'
    , 'audio/mpeg3'
    , 'audio/mp3'
    , 'audio/x-mpeg-3'
    , 'audio/x-wav'
    , 'audio/wav'
    , 'audio/aiff'
    , 'audio/x-aiff'
    , 'audio/ogg'
    , 'audio/flac'
    , 'audio/x-flac'
    , 'audio/m4a'
    , 'audio/x-aac'
  ];
}
