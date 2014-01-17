/*
 * audio-matcher.js: 
 * (C) 2014 Ayatii Limited
 * Uses AcousticID's chromaprint to generate two fingerprints and then simply compares both.
 * Those to be seen to report a similarity score from .2->.9x are usually a match.
 * Have yet to come across a high scoring match (i.e one with 1-9/10 score) which is not a match.
 * 
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , exec = require('child_process').execFile
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('audio-matcher.js')  
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

var AudioMatcher = module.exports = function() {
  this.infringements_ = null;
  this.storage_ = null;
  this.verifications_ = null;
  this.init();
}

util.inherits(AudioMatcher, events.EventEmitter);

AudioMatcher.prototype.init = function() {
  this.results = {};
  this.tmpDirectory = '';
  this.campaign = null;
}

AudioMatcher.prototype.createParentFolder = function(){
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

AudioMatcher.prototype.downloadThing = function(downloadURL, target){
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

AudioMatcher.prototype.cleanupEverything = function() {
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
AudioMatcher.prototype.cleanupInfringement = function() {
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
    return promise;
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
AudioMatcher.prototype.fetchCampaignAudio = function(done) {
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
    done(err);
  }); 
}

AudioMatcher.prototype.copyDownload = function(download, track){
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

AudioMatcher.prototype.goMeasureDownload = function(download, done, autoverifierDone){
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
  Promise.seq(promiseArray)
    .then(function(){ return self.examineDownloadScores(download) })
    .then(function(results){

      if(results[0]){
        autoverifierDone(new Error('Music Verifier returned a non-sensical result'));
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

AudioMatcher.prototype.fetchDownload = function(download, done){
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


AudioMatcher.prototype.newCampaignChangeOver = function(haveRunAlready, campaign, done, autoverifierDone){
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

AudioMatcher.prototype.prepCampaign = function(campaign, done, autoverifierDone){
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

AudioMatcher.prototype.match = function(campaign, download, done){

}



