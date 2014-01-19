/*
 * Musicverifier.js: 
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('musicverifier.js')  
  , states = acquire('states').infringements.state  
  , util = require('util')
  , utilities = acquire('utilities') 
  , verificationChecker = require('./verification-checker')
  ;

var AudioMatcher = require('./audio-matcher.js')
  , Seq = require('seq')   
  , Verifications = acquire('verifications');
  ;

var MusicVerifier = module.exports = function() {
  this.verifications_ = null;
  this.audioMatcher_ = null;
  this.init();
}

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.audioMatcher_ = new AudioMatcher();
  self.verifications_ = new Verifications();
  self.results = [];
}

MusicVerifier.prototype.analyseAndRecord = function(results, done) {
  var self = this;
  Seq(results)
    .seqEach(function(result){
      logger.info('analyse and submit ' + JSON.stringify(result));
      //self.verifications_.submit(result, this);
    })
    .seq(function(){
      logger.info('finished recording each verification')
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

MusicVerifier.prototype.processMatching = function(campaign, work, done){
  var self = this;

  Seq(work)
    .seqEach(function(download){
      var that = this;
      self.audioMatcher_.process(campaign, download, function(err, result){
        if(err)
          return that(err);
        self.analyseAndRecord(result, that);
      });
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}


//
// Public
//
MusicVerifier.prototype.verify = function(campaign, infringement, downloads, done){
  var self = this
    , dlMd5s = []
    , result = {started : Date.now(),
                who : "MusicVerifer AKA Harry Caul",
                state : states.UNVERIFIED}
  ;
  
  dlMd5s = downloads.map(function(dl){ return dl.md5});

  logger.info(infringement._id + ': Trying music verification for %s with downloads length : ',
   infringement.uri, downloads.length);
  
  Seq()
    .seq(function(){
      // Check if to see if there are records against these downloads 
      // Bump positive verifications if they exist.
      self.verifications_.checkDownloads(campaign, downloads, this);
    })
    .seq(function(previous){
      // If no previous verifications then move straight on to matching
      if(previous || previous.isEmpty())
        return this(null, downloads);

      var remaining = dlMd5s.subtract(previous.map(function(verdict){return verdict._id.md5}));
      self.results = previous; // cache the previous verifications
      
      // Do we have a full history of verifications
      if(remaining.isEmpty()){
        logger.info('We think we have no more downloads to process, previous verifications exist for all downloads');
        return this();
      }
      // Send on the remaining work to the matcher.
      this(null, remaining);
    })
    .seq(function(workToDo){
      if(!workToDo || workToDo.isEmpty())
        return this();
      var cherryPicked = downloads.filter(function(dld){return workToDo.some(dld.md5)});
      self.processMatching(campaign, cherryPicked, this);
    })
    .seq(function(){

      // Final check to see if we have a full set of verifications
      var remaining = dlMd5s.subtract(self.results.map(function(verdict){ return verdict._id.md5 }));
      var verified = self.results.map(function(verdict){ return verdict.verified }).max();
      
      result.finished = Date.now();

      if(verified){
        logger.info('Certain that we have a positive from a previous verification(s).');
        result.state = states.VERIFIED;
      }
      else if(!verified && remaining.isEmpty()){
        logger.info('Certain that we have a false positive from all downloads in verifications.');
        result.state = states.FALSE_POSITIVE;
      }
      else if(!verified && !remaining.isEmpty()){
        logger.info("it looks as if we didn't process all the downloads, verdict stands at UNVERIFIED")
      }
      done(null, result);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

MusicVerifier.prototype.finish = function(){
  var self = this;
  self.audioMatcher_.cleanEverything();
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

/*
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
MusicVerifier.prototype.examineDownloadScores = function(download){
  var self = this;
  var matchedTracks = [];
  var failedEvaluations = [];
  var err = null;
  var MATCHER_THRESHOLD = 0.3;
  var promse = new Promise.Promise();



  // First sanity check
  var problems = self.campaign.metadata.tracks.map(function(track){ 
    if(track.fpevalResults.download && track.fpevalResults.download !== download.md5)
      return track;
  });

  if(!problems.isEmpty()){
    return promise.reject(new Error('download md5 on track dont match with the dowload that it was supposed to match against : ' + download.md5 + ' and problem tracks are : ' + JSON.stringify(problems)));
  }

  // Second attempt to filter which tracks have a score above the MATCHER_THRESHOLD regardless if something failed
  self.campaign.metadata.tracks.each(function(track){
    if(track.fpevalResults.score && track.fpevalResults.score > MATCHER_THRESHOLD){ 
      if(!matchedTracks.isEmpty())
        logger.warn(self.infringement._id + ": Music Verifier has found two potential matches for one infringement in the same album - other score = " + 
                     matchedTracks.last().fpevalResults.score + ' and this score : ' + track.fpevalResults.score + " for uri : " + self.infringement.uri);
      matchedTracks.push(track);
    }
  });

  // Then check that fpeval could carry out a match on every track, 
  failedEvaluations = self.campaign.metadata.tracks.map(function(track){ 
    if(track.fpevalResults.score && track.fpevalResults.score < 0)
      return track;
  }).unique();

  Seq()
    .seq(function(){ 
      if(!failedEvaluations.isEmpty() && matchedTracks.isEmpty()){
        // Only error when there was an error and no match (the error might have prevented a match)
        err = new Error('FpEval failed to carry out any match');        
        return this();
      }
      // otherwise update verifications
      var verified = !matchedTracks.isEmpty();
      var trackId = matchedTracks.isEmpty() ? -1 : matchedTracks[0].position; 

      self.verifications_.submit( self.infringement,
                                  verified,
                                  download.md5,
                                  trackId,
                                  matchedTracks.average('score'),
                                  false,
                                  this);
    })
    .seq(function(){
      if(err)
        return this();
      // other wise go fill out the verification object
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
      this();
    })
    .seq(function(){
      promise.resolve([err, verificationObject]);
      this();
    })
    .catch(function(err){
      logger.warn(err);
      promise.reject(err);
    })
    ;
  return promise();
}

*/