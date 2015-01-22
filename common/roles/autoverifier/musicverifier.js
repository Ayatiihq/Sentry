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
  ;

var AudioMatcher = require('./audio-matcher.js')
  , Infringements = acquire('infringements') 
  , Seq = require('seq')   
  , Verifications = acquire('verifications');
  ;

var MusicVerifier = module.exports = function() {
  this.verifications_ = null;
  this.infringements_ = null;
  this.audioMatcher_ = null;
  this.init();
}

var MATCHER_THRESHOLD = 0.3;
var UNUSUAL_THRESHOLD = 0.1;

util.inherits(MusicVerifier, events.EventEmitter);

MusicVerifier.prototype.init = function() {
  var self = this;
  self.audioMatcher_ = new AudioMatcher();
  self.infringements_ = new Infringements();
  self.verifications_ = new Verifications();
  self.results = [];
}

MusicVerifier.prototype.analyseAndSubmit = function(campaign, results, done) {
  var self = this;

  // sanity check
  if(results.map(function(result){ return result._id.md5}).unique().length !== 1)
    return done(new Error('audio-matcher is returning arrays with multiple md5s !'));

  // Filter out results that have scores between 0.1 and 0.3, these are unusual, log.
  var unusuals = results.filter(function(result){return (result.score >= UNUSUAL_THRESHOLD
    && result.score < MATCHER_THRESHOLD)});
  // hopefully we only have one in here, straight for the juggler.
  var positives = results.filter(function(result){return result.score >= MATCHER_THRESHOLD});

  if(positives.isEmpty()){ 
    // handle easy case of all negative.
    logger.info('looks like we have a false positive, submit to verifications and move on');
    // Just use the first result (its all the same) to submit the negative verification.
    results[0].verified = false;
    // update our in memory cache 
    self.results.push(results[0]); 
    return self.verifications_.create(results[0], done);
  }
  // What ? we have two matches on the one download !
  if(positives.length > 1){
    logger.warn('one download matched multiple tracks in a campaign ' + campaign.name +
     ' : '+ JSON.stringify(positives));
    // move on for now, be optimistic.
  }
  // What ? we have unusuals !?
  if(unusuals.length > 0){
    logger.warn('one download matched with scores below the threshold but above 0.1 - investigate, campaign '
     + campaign.name +' : '+ JSON.stringify(unusuals));
    // move on for now, be optimistic.
  }

  // Success. take the first positive
  logger.info('looks we have a positive, track number ' + positives[0].assetNumber);
  positives[0].verified = true;
  self.results.push(positives[0]);
  return self.verifications_.create(positives[0], done);
}

MusicVerifier.prototype.processMatching = function(campaign, work, done){
  var self = this;

  Seq(work)
    .seqEach(function(download){
      var that = this;
      self.audioMatcher_.process(campaign, download, function(err, results){
        if(err)
          return that(err);
        self.analyseAndSubmit(campaign, results, that);
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
  self.results.length = 0; //zero our results array.

  logger.info(infringement._id + ': Trying music verification for %s with downloads length : ',
   infringement.uri, downloads.length);
  
  Seq()
    .seq(function(){
      // Check if to see if there are records against these downloads 
      // Bump positive verifications if they exist.
      self.verifications_.getRelevantAndBumpPositives(campaign, downloads, this);
    })
    .seq(function(previous){
      // If no previous verifications then move straight on to matching
      if(!previous || previous.isEmpty())
        return this(null, downloads);

      var remainingMd5s = dlMd5s.subtract(previous.map(function(verdict){return verdict._id.md5}));
      self.results = previous; // cache the previous verifications
      
      // Do we have a full history of verifications
      if(remainingMd5s.isEmpty()){
        logger.info('We think we have no more downloads to process, previous verifications exist for all downloads');
        return this();
      }
      var remaining = downloads.filter(function(dld){return remainingMd5s.some(dld.md5)});
      // Send on the remaining work to the matcher.
      this(null, remaining);
    })
    .seq(function(workToDo){
      if(!workToDo || workToDo.isEmpty()){
        return this();
      }
      //var cherryPicked = downloads.filter(function(dld){return workToDo.some(dld.md5)});
      self.processMatching(campaign, workToDo, this);
    })
    .seq(function(){
      // Final check to see if we have a full set of verifications
      var remaining = dlMd5s.subtract(self.results.map(function(verdict){ return verdict._id.md5 }));
      var verified = self.results.map(function(verdict){ return verdict.verified }).max();
      
      result.finished = Date.now();

      if(verified){
        logger.info('Certain that we have a positive from old or new verification(s).');
        result.state = states.VERIFIED;
      }
      else if(!verified && remaining.isEmpty()){
        logger.info('Certain that we have a false positive from all downloads.');
        result.state = states.FALSE_POSITIVE;
      }
      else if(!verified && !remaining.isEmpty()){
        logger.info("it looks as if we didn't process all the downloads, verdict stands at UNVERIFIED")
      }
      // finally keep track of matched assets on verified, needed for precise notices
      if(verified){
        var verifiedAssetNumbers = self.results.filter(function(verdict){
          return verdict.verified}).map(function(positive){
        return positive.assetNumber});

        logger.info('update metadata with  ' + verifiedAssetNumbers.length + ' track number(s)');
        self.infringements_.setMetadata(infringement, 'matchedAssets', verifiedAssetNumbers, this);
      }
      else{
        this();
      }
    })
    .seq(function(){
      done(null, result);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

MusicVerifier.prototype.finish = function(){
  var self = this;
  self.audioMatcher_.cleanupEverything();
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
