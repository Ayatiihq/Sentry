/*
 * Musicverifier.js: 
 * (C) 2013 Ayatii Limited
 * Uses AcousticID's chromaprint to generate two fingerprints and then simply compares both.
 * Those to be seen to report a similarity score from .2->.9x are usually a match.
 * Have yet to come across a high scoring match (i.e one with 1-9/10 score) which is not a match.
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , exec = require('child_process').execFile
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('musicverifier.js')  
  , os = require('os')
  , path = require('path')
  , request = require('request')
  , rimraf = require('rimraf')
  , states = acquire('states').infringements.state  
  , util = require('util')
  , utilities = acquire('utilities') 
  ;

var Infringements = acquire('infringements')
  , Promise = require('node-promise')
  , Seq = require('seq')
  , Storage = acquire('storage')
  , URI = require('URIjs')   
  , Verifications = acquire('verifications');
  ;

var MEDIA = 'https://qarth.s3.amazonaws.com/media/';

var MusicVerifier = module.exports = function() {
  this.infringements_ = null;
  this.storage_ = null;
  this.verifications_ = null;
  this.init();
}

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.tmpDirectory = null;
  self.storage_ = new Storage('downloads');
  self.infringements_ = new Infringements();
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

  // First check that fpeval could carry out a match, if any of the match attempts fail (score === -1 | no score at all !)
  // then return with error.
  var failedEvaluation = self.campaign.metadata.tracks.map(function(track){ 
    if(!track.fpevalResults.score)
      return track;
    return track.fpevalResults.score < 0;
  }).unique();

  if(!failedEvaluation.isEmpty()){
    logger.warn(self.infringement._id + ': Failed to match with FPeval, more than likely an issue with downloading the infringment');
    return [new Error('FpEval failed to carry out any match'), verificationObject];
  }

  // Next attempt to filter which tracks have a score above the MATCHER_THRESHOLD
  self.campaign.metadata.tracks.each(function(track){
    if(track.fpevalResults.score > MATCHER_THRESHOLD){ 
      if(!matchedTracks.isEmpty())
        logger.warn(self.infringement._id + ": Music Verifier has found two potential matches for one infringement in the same album - other score = " + 
                     matchedTracks.last().fpevalResults.score + ' and this score : ' + track.fpevalResults.score + " for uri : " + self.infringement.uri);
      matchedTracks.push(track);
    }
  });
  
  var success = false;

  if(!matchedTracks.isEmpty()){ // Only update when we have something to write there.
    // Update the DB with the matched tracks (regardless of what we decide on below)
    var matchedCombined = self.infringement.metadata.matchedTracks ? self.infringement.metadata.matchedTracks.union(matchedTracks) : matchedTracks;
    self.infringements_.setMetadata(self.infringement, 'matchedTracks', matchedCombined);
  }
  if(matchedTracks.length > 1){
    // At this point if we have more than 1 track which matched successfully we want to make sure the delta between the scores
    // is greater than 0.2 inorder to be confident that we have a genuine match. Deltas which are less than 0.2 indicate a very
    // inaccurate and fuzzy resultset => mark unsuccessfull
    var delta = matchedTracks.reduce(function(a, b){
      return a-b;
    });
    logger.warn(self.infringement._id + ': We found ' + matchedTracks.length + ' matches and the delta between them is ' + delta);
    success = delta > 0.2; // simplistic but safe.
    if(success){
      verificationObject = Object.merge (verificationObject,
                                        {"state" : states.VERIFIED,
                                         "notes" : "Success but we found more than one match where the delta between the matches was > 0.2, please examine infringement (remixes more than likely), matched tracks are : " + JSON.stringify(matchedTracks.map(function(tr){return tr.title}))});
    }
    else{
      verificationObject.state = states.FALSE_POSITIVE
      verificationObject.notes = "found more than one match where the delta between the matches was < 0.2, please examine infringement, matched tracks are : " + JSON.stringify(matchedTracks.map(function(tr){return tr.title}));
      err = new Error('Hmm matched two originals against an infringement on a given campaign : ' + JSON.stringify(matchedTracks));      
    }
  }
  else{ // Else just check for the simple lone match. Write up notes accordingly
    success = matchedTracks.length === 1; 
    if(success){
      verificationObject = Object.merge (verificationObject, 
                                        {"state" : states.VERIFIED,
                                         "notes" : matchedTracks[0].title});
    }
    else{
      verificationObject.state = states.FALSE_POSITIVE;
      verificationObject.notes = "Harry Caul did not find any match.";
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
    track.folderPath = path.join(self.tmpDirectory, track.md5);
    track.fpevalResults = {};
    fs.mkdirSync(track.folderPath);
    var original = path.join(MEDIA, self.campaign._id, track.md5);

    self.downloadThing(original, path.join(track.folderPath, "original")).then(
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

MusicVerifier.prototype.newCampaignChangeOver = function(haveRunAlready, campaign, done, autoverifierDone){
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
      autoverifierDone(err);//let's get out of here if we have trouble swapping campaigns.
    });
  });
}

MusicVerifier.prototype.prepCampaign = function(campaign, done, autoverifierDone){
  var self = this;

  var sameCampaignAsBefore = self.campaign &&
                             self.campaign._id === campaign._id;
  if(!sameCampaignAsBefore){
    logger.info()
    self.newCampaignChangeOver(!!self.campaign, campaign, done);
  }
  else{ // Same campaign as before, keep our one in memory but reset the track.fpevalResults
    logger.trace("we just processed that campaign, use what has already been downloaded.")
    self.campaign.metadata.tracks.each(function resetScore(track){
      track.fpevalResults = {};
    });      
    done();
  }
}

MusicVerifier.prototype.copyDownload = function(download, track){
  var promise = new Promise.Promise();
  fs.copy(path.join(self.tmpDirectory, download.md5),
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

MusicVerifier.prototype.goMeasureDownload = function(download, done, autoverifierDone){
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
          track.fpevalResults = {download: download.md5, score: result.score};
        }
        catch(err){
          logger.error(self.infringement._id + ": Error parsing FPEval output (" + err + "): " + stdout + ':' + stderr);
          track.fpevalResults = {download: download.md5, score: -1};// -1 signifying fpeval failed for some reason.
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
  // Gather scores against each campaign track, submit fpeval results per md5,
  // then return verification decision to autoverifier
  Promise.seq(promiseArray).then(function(){ return self.recordVerfications()}).then(
    function(){
      var results = self.examineResults();
      if(results[0]){
        autoverifierDone(new Error('examine Results returned a nonsensical result'));
        return;
      }
      if(results[1].state === states.VERIFIED){
        // report back immediately once we are confident we have one match.
        logger.info('We have found a match ! - return immediately');
        autoverifierDone(null, results[1]);
      }
      else{ // Move on to the next track, nothing to report back here.
        logger.info('moving to the next track');
        done();
      }
    },
    function(err){
      done(err);
    }
  );
}

MusicVerifier.prototype.recordVerfications = function(){
  var self = this;

  Seq(self.campaign.metadata.tracks)
    .seqEach(function(track){
      

    })
    .seq(function(){

    })
    .catch(function(err){

    })
    ;
  var promise = new Promise.Promise();
  // RECORD
  function record(verification){
    var promise = new Promise.Promise();
    self.verifications_
  };
  self.campaign.metadata.tracks.each(function(track){

  });
  return promise;
}

/*
 * Fetch a download
 */
MusicVerifier.prototype.fetchDownload = function(download, done){
  var self = this;
  var uri = self.storage_.getURL(self.infringement.campaign, download.md5);
  var target = path.join(self.tmpDirectory, download.md5);
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
  self.infringement = infringement;
  self.startedAt = Date.now();

  logger.info(self.infringement._id + ': Trying music verification for %s', infringement.uri);
  
  Seq()
    .seq(function(){
      self.prepCampaign(campaign, this, done);
    })
    set(downloads)
    .seqEach(function(download){
      var that = this;
      var isAudio = MusicVerifier.getSupportedMimeTypes().some(download.mimetype);
      if(isAudio){
        logger.info('fetch Download');
        self.fetchDownload(download, that);
      }
      else
        that();
    })
    .seqEach(function(download){
      var that = this;
      fs.stat(path.join(self.tmpDirectory, download.md5), function(err, result){
        if(err){
          logger.warn("didn't find a download locally, must never have been fetched.");
          return that();// don't evaluate those that were not downloaded (not an audio file)        
        }
        self.cleanupInfringement().then(function(){
          self.goMeasureDownload(download, that, done);      
        },
        function(err){
          logger.warn('Problem cleaning infringement %s', err);
          that();
        });
      });
    })
    .seq(function(){
      logger.info('Finished multi-file verification, didnt match obviously');
      done(null, {started : self.startedAt,
                  who : "MusicVerifer AKA Harry Caul",
                  finished : Date.now(),
                  state: states.FALSE_POSITIVE,
                  notes: 'Harry Caul failed to match'});
    })
    .catch(function(err) {
      logger.warn('Unable to process music-verification: %s', err);
    })    
    ;
}

MusicVerifier.prototype.finish = function(){
  var self = this;
  
  if(self.tmpDirectory) {
    self.cleanupEverything().then(function(){
      self.tmpDirectory = null;
    });
  }
}

MusicVerifier.getSupportedMimeTypes = function() {
  return [
      'audio/mpeg' // default mime-type
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
