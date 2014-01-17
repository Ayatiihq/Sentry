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
  , All = require('node-promise').all
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
  this.tmpDirectory = null;
  this.campaign = null;
}

AudioMatcher.prototype.createParentFolder = function(){
  var self = this;
  var promise = new Promise.Promise();
  self.tmpDirectory = path.join(os.tmpDir(), utilities.genLinkKey(self.campaign.name)); 
  self.cleanupEverything().then(function(){
    logger.info('Creating parent folder : ' + self.tmpDirectory);
    fs.mkdir(self.tmpDirectory, function(err){
      if(err){
        logger.error('Error creating parenting folder : ' + err);
        promise.reject(err);
        return;
      }
      promise.resolve();
    });    
  });
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
  promiseArray = self.campaign.metadata.assets.map(function(track){ return fetchTrack.bind(self, track)});
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

AudioMatcher.prototype.goMeasureDownload = function(download, done){
  var self = this;
  var results = [];

  function compare(track){
    var promise = new Promise.Promise();
    logger.info('about to evaluate ' + track.title + ' at ' + track.folderPath);
    exec(path.join(process.cwd(), 'bin', 'fpeval'), [track.folderPath],
      function (error, stdout, stderr){
        if(stderr && !stderr.match(/Header\smissing/g))
          logger.error(self.infringement._id + ": Fpeval standard error : " + stderr);
        if(error && !stderr.match(/Header\smissing/g))
          logger.warn(self.infringement._id + ": warning running Fpeval: " + error);                    
        
        try{ // Try it anyway (sometimes warnings about headers are seen but FFMPEG should be able to handle it)
          var result = JSON.parse(stdout);
          logger.info('Track : ' + track.title + '-  result : ' + JSON.stringify(result));
          results.push({_id : {md5 : download.md5}, score: result.score, assetNumber : track.number});
        }
        catch(err){
          logger.error(self.infringement._id + ": Error parsing FPEval output (" + err + "): " + stdout + ':' + stderr);

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

  var matchOperations;
  
  matchOperations = self.campaign.metadata.assets.map(function(track){return doIt.bind(null, track)});
  
  All(matchOperations).then(function(){
    done(null, results);
    },
    function(err){
      done(err);
  });
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
      if(err)
        return promise.reject(err);

      var matched = false;
      files.each(function(file){
        if(file.match(/infringement/g)){
          matched = true;
          fs.unlink(path.join(dir, file), function (err) {
            if(err){
              logger.warn('error deleting ' + err + path.join(dir, file));
              return promise.reject(errr);              
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
  promiseArray = self.campaign.metadata.assets.map(function(track){ 
    if(track.folderPath) 
      return deleteInfringement.bind(null, track.folderPath);
  });

  Promise.seq(promiseArray).then(function(){
    logger.info('Finished deleting infringements from track folders.')
    wrapperPromise.resolve();
   },
   function(err){
    wrapperPromise.reject(err);   
  });   
  return wrapperPromise;
}

AudioMatcher.prototype.cleanupEverything = function() {
  var self = this;
  logger.info('cleanupEverything');  
  var promise = new Promise.Promise();

  if(!self.tmpDirectory)// first pass.
    return promise.resolve();

  rimraf(self.tmpDirectory, function(err){
    if(err){
      logger.warn('Unable to rmdir ' + self.tmpDirectory + ' error : ' + err);
      return promise.reject(err);
    }
    promise.resolve();
  });
  return promise;
}

AudioMatcher.prototype.newCampaignChangeOver = function(campaign, done){
  var self = this; 
  logger.info('New campaign - ' + campaign.name);
  self.cleanupEverything().then(function(){
    // Only on a new campaign do we overwrite 
    // (We want to still know about folderpaths)
    self.campaign = campaign; 

    self.createParentFolder().then(function(){
      self.fetchCampaignAudio(done);
     },
     function(err){
      done(err);
    });
  });
}

AudioMatcher.prototype.prepCampaign = function(campaign, done){
  var self = this;

  var sameCampaignAsBefore = self.campaign &&
                             self.campaign._id === campaign._id;

  if(!sameCampaignAsBefore)
    return self.newCampaignChangeOver(campaign, done);

  logger.info("Use the same campaign");

  self.cleanupInfringement().then(function(){
    done();
   },
   function(err){
    done(err);
  });
}

AudioMatcher.prototype.process = function(campaign, download, done){
  var self = this;

  Seq()
    .seq(function(){
      self.prepCampaign(campaign, this)
    })
    .seq(function(){
      logger.info('measure ' + download.md5 +' against ' + campaign.name);
      self.goMeasureDownload(download, this);
    })
    .seq(function(results){
      logger.info('Results ' + JSON.stringify(results));
      done(results);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

