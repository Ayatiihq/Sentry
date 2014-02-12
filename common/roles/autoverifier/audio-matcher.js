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
  , sugar = require('sugar')
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

var MEDIA = 'https://s3.amazonaws.com/qarth/media/';
var DOWNLOADS = 'https://s3.amazonaws.com/qarth/downloads/';

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
  self.tmpDirectory = path.join(os.tmpDir(), utilities.genLinkKey(self.campaign.name); 
  
  self.cleanupEverything().then(function(){
    fs.mkdir(self.tmpDirectory, function(err){
      if(err){
        logger.error('Error creating parenting folder : ' + err);
        return promise.reject(err);
      }
      promise.resolve();
    });
   },
   function(err){
    promise.reject(err);
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
    
    fs.mkdir(track.folderPath, function(err){
      if(err)
        return promise.reject(err);
      
      var out = fs.createWriteStream(path.join(track.folderPath, 'original'));
      var original = MEDIA + path.join(self.campaign._id, track.md5);      
      utilities.requestStream(original, {}, function(err, req, res, stream) {
        if(err){
          logger.error('unable to fetch ' + original + ' error : ' + err);
          promise.reject(err);
          return;
        }
        stream.pipe(out);
        stream.on('error', function(err){
          promise.reject(err);
        });
        stream.on('end', function() {
          promise.resolve();
        });
      });
    });
    return promise;
  }

  var promiseArray;
  promiseArray = self.campaign.metadata.assets.map(function(track){ return fetchTrack.bind(null, track)});
  Promise.seq(promiseArray).then(function(){
    logger.info('all campaign assets downloaded');
    done();
  },
  function(err){
    done(err);
  }); 
}

/*
 * Attempt to clean the file called infringement from each track folder
 * TODO refactor
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

AudioMatcher.prototype.queryFpEval = function (track, cb){
  var self = this;
  exec(path.join(process.cwd(), 'bin', 'fpeval'), [track.folderPath],
    function (error, stdout, stderr){
      if(stderr && !stderr.match(/Header\smissing/g))
        logger.error(": Fpeval standard error : " + stderr);
      if(error && !stderr.match(/Header\smissing/g))
        logger.warn(": warning running Fpeval: " + error);                    
      
      try{ // Try it anyway (sometimes warnings about headers are seen but FFMPEG should be able to handle it)
        var result = JSON.parse(stdout);
        // logger.info('Track : ' + track.title + '-  result : ' + JSON.stringify(result));
        // might aswell fill out as much as possible the soon to be created verification object
        cb(null, result);
      }
      catch(err){
        logger.error("Error parsing FPEval output (" + err + "): " + stdout + ':' + stderr);
        cb(err);
      }
    });
}

AudioMatcher.prototype.match = function(download, done){
  var self = this
    , results = []
  ;

  Seq(self.campaign.metadata.assets)
    .seqEach(function(track){
      var that = this;
      self.queryFpEval(track, function(err, score){
        if(err)
          return done(err);
        var result = {_id : {md5 : download.md5,
                             campaign : self.campaign._id,
                             client : self.campaign.client},
                      score: score.score,
                      assetNumber : track.number};
        results.push(result);
        that();
      });
    })
    .seq(function(){
      done(null, results);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

AudioMatcher.prototype.cleanupEverything = function() {
  var self = this
    , promise = new Promise.Promise()
  ;

  var location = self.tmpDirectory ||
                 path.join(os.tmpDir(), utilities.genLinkKey(self.campaign.name);

  fs.exists(location, function(present){
    if(!present)
      return promise.resolve();

    rimraf(location, function(err){
      if(err){
        logger.warn('Unable to rmdir ' + location + ' error : ' + err);
        return promise.reject(err);
      }
      promise.resolve();
    });
  });
  return promise;
}

AudioMatcher.prototype.positionDownload = function(download, done){
  var self = this
    , remoteDownload = DOWNLOADS + path.join(self.campaign._id, download.md5)
    , out = fs.createWriteStream(path.join(self.tmpDirectory, 'infringement'))
  ;

  function moveToTracks(done){
    Seq(self.campaign.metadata.assets)
      .seqEach(function(track){
        fs.copy(path.join(self.tmpDirectory, 'infringement'),
                path.join(track.folderPath, 'infringement'),
                this);
      })
      .seq(function(){
        done();
      })
      .catch(function(err){
        done(err);
      })
      ;
  }

  Seq()
    .seq(function(){
      var that = this;
      utilities.requestStream(remoteDownload, {}, function(err, req, res, stream) {
        if(err){
          logger.error('unable to fetch ' + remoteDownload + ' error : ' + err);
          return that(err);
        }
        stream.pipe(out);
        stream.on('error', function(err){
          that(err);
        });
        stream.on('end', function() {
          that();
        });
      });
    })
    .seq(function(){
      moveToTracks(this);
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

AudioMatcher.prototype.newCampaignChangeOver = function(campaign, done){
  var self = this;

  // Only on a new campaign do we overwrite 
  // (We want to still know about folderpaths)
  self.campaign = campaign; 

  self.createParentFolder().then(function(){
    self.fetchCampaignAudio(done);
   },
   function(err){
    done(err);
  });
}

AudioMatcher.prototype.prepCampaign = function(campaign, done){
  var self = this;

  var sameCampaignAsBefore = self.campaign &&
                             self.campaign._id === campaign._id;

  if(!sameCampaignAsBefore)
    return self.newCampaignChangeOver(campaign, done);

  logger.info("Use the same campaign");

  self.cleanupInfringement(campaign).then(function(){
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
      self.positionDownload(download, this);
    })
    .seq(function(){
      //logger.info('measure ' + download.md5 +' against ' + campaign.name);
      self.match(download, this);
    })
    .seq(function(results){
      logger.info('Campaign : ' + campaign.name + 
                  '\nMd5 : ' + download.md5 + '\nAudio-Matcher Results : ' + JSON.stringify(results));
      done(null, results);
    })
    .catch(function(err){
      logger.info('problem matching audio' + err);
      done(err);
    })
    ;
}

