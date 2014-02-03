/*
 * verifier.js: the verifier
 *
 * (C) 2012 Ayatii Limited
 *
 * Verifier processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('verifier.js')
  , Seq = require('seq')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Verifications = acquire('verifications')
  ;

var MAX_LINKS = 100;

var Verifier = module.exports = function() {
  this.campaigns_ = null;
  this.hosts_ = null;
  this.infringements_ = null;
  this.settings_ = null;
  this.jobs_ = null;
  this.verifications_ = null;

  this.campaign_ = null;
  this.started_ = false;

  this.lastTimestamp_ = 0;
  this.touchId_ = 0;

  this.timestampIsVerified_ = true;

  this.init();
}

util.inherits(Verifier, Role);

Verifier.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.hosts_ = new Hosts();
  self.settings_ = new Settings('role.verifier');
  self.jobs_ = new Jobs('verifier');
  self.verifications_ = new Verifications();
  self.on('error', self.stopBeat.bind(self));
  self.on('finished', self.stopBeat.bind(self));
}

Verifier.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);
  logger.info('%j', job);

  logger.info('Choosing consumer');

  self.campaigns_.getDetails(job._id.owner, function(err, campaign) {
    if (err) {
      self.emit('error', err);
      return;
    }

    self.campaign_ = campaign;
    self.startBeat(self.campaigns_, campaign);
    var consumer = job._id.consumer;

    if (consumer.has('known-ids'))
      self.verifyKnownIDs(self.campaign_, job);
    else if (consumer.has('rtl'))
      self.verifyRTL(self.campaign_, job);
    else
      self.verifyLTR(self.campaign_, job);
  });
}

Verifier.prototype.getCampaignKey = function(campaign) {
  return util.format('%s.%s.%s', campaign.name, campaign.created, 'timestamp');
}

//
// RTL Verifications (parent <- child)
//

Verifier.prototype.verifyRTL = function(campaign, job) {
  var self = this
    , key = self.getCampaignKey(campaign) + ".rtl"
    ;

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, 
  config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  Seq()
    .seq('Get last verify timestamp', function() {
      var that = this;
      
      logger.info('Key %s', key);
      self.settings_.get(key, function(err, value) {
        if (err) console.warn(err);
        
        if (!value)
          value = 0;

        that(null, value);
      });
    })
    .seq('Process all new verifications', function(from) {
      self.lastTimestamp_ = from ? from : 0;
      self.processAllVerifications(campaign, this);
    })
    .seq('Finish up', function(){
      var timestamp = self.lastTimestamp_;
      
      logger.info('Finishing up verification for campaign %j on timestamp %d', campaign._id, timestamp);
      
      self.settings_.set(key, timestamp);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to verify links for %j: %j', campaign._id, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Verifier.prototype.processAllVerifications = function(campaign, done, lastId) {
  var self = this
    , from = self.lastTimestamp_
    ;

  logger.info('Verifying links for %j from timestamp %s', campaign._id, from);

  self.verifications_.getThoseInNeedOfVerification(campaign, Date.create(from), MAX_LINKS, function(err, endpoints) {
    if (err || endpoints.length == 0 || endpoints.last()._id == lastId)
      return done(err);

    logger.info('Got %d endpoints to process on this round', endpoints.length);
    self.verifyLinks(campaign, endpoints, function(err) {     
      if (err)
        return done(err);

      // Try to get more endpoints to processs
      self.processAllVerifications(campaign, done, endpoints.last()._id);
    });
  });
}

Verifier.prototype.verifyLinks = function(campaign, endpoints, done) {
  var self = this;

  Seq(endpoints)
    .seqEach(function(endpoint) {
      self.dominoEndpoint(campaign, endpoint, this);
    })
    .seq('done', function() {  
      done(null);
    })
    .catch(done)
    ;
}

Verifier.prototype.dominoEndpoint = function(campaign, endpoint, done) {
  var self = this;

  logger.info('%s has %d parents', endpoint._id, endpoint.parents.uris.length);
  // slightly hacky but don't really want to screw with adding more state to infringements right now
  // processor does similar checks, we just do them again and ignore the infrigement in the same case 
  // as processor which stops verifier resetting its state
  var isDomain = !utilities.uriHasPath(endpoint.uri);
  if (isDomain && endpoint.who === 'processor') { done(); }
  else { 
   Seq(endpoint.parents.uris)
     .seqEach(function(parent) {
       self.updateParentState(campaign, endpoint, parent, this);
     })
     .seq(function() {
       if (self.timestampIsVerified_)
         self.lastTimestamp_ = endpoint.verified;
       else
         self.lastTimestamp_ = endpoint.parents.modified;
       done();
     })
     .catch(done)
     ;
  }
}

Verifier.prototype.updateParentState = function(campaign, endpoint, parentUri, done) {
  var self = this
    , infringement = {}
    ;

  if (parentUri.startsWith('meta')) {
    infringement._id = parentUri.split(':')[1];
  } else {
    infringement._id = self.infringements_.generateKey(campaign, parentUri);
  }
  logger.info('Setting %s to %d for %s', infringement._id, endpoint.state, endpoint._id);
  self.verifications_.verifyParent(infringement, endpoint.state, done);
}

//
// LTR Verifications (parent -> child)
//

Verifier.prototype.verifyLTR = function(campaign, job) {
  var self = this
    , key = self.getCampaignKey(campaign) + ".ltr"
    ;

  self.timestampIsVerified_ = false;

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, 
  config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  Seq()
    .seq('Get last ltr verify timestamp', function() {
      var that = this;
      
      logger.info('Key %s', key);
      self.settings_.get(key, function(err, value) {
        if (err) console.warn(err);
        
        if (!value)
          value = 0;

        that(null, value);
      });
    })
    .seq('Process all new verifications', function(from) {
      self.lastTimestamp_ = from ? from : 0;
      self.processAllLTRVerifications(campaign, this);
    })
    .seq('Finish up', function(){
      var timestamp = self.lastTimestamp_;
      
      logger.info('Finishing up verification for campaign %j on timestamp %d', campaign._id, timestamp);
      
      self.settings_.set(key, timestamp);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to mine links for %j: %s', campaign._id, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Verifier.prototype.processAllLTRVerifications = function(campaign, done, lastId) {
  var self = this
    , from = self.lastTimestamp_
    ;

  logger.info('Verifying ltr links for %j from timestamp %s', campaign._id, from);

  self.verifications_.getAdoptedEndpoints(campaign, Date.create(from), MAX_LINKS, function(err, endpoints) {
    if (err || endpoints.length == 0 || endpoints.last()._id == lastId)
      return done(err);

    logger.info('Got %d endpoints to process on this round', endpoints.length);
    self.verifyLinks(campaign, endpoints, function(err) {     
      if (err)
        return done(err);

      // Try to get more endpoints to processs
      self.processAllLTRVerifications(campaign, done, endpoints.last()._id);
    });
  });
}

//
// Known IDs Verifier
//
Verifier.prototype.verifyKnownIDs = function(campaign, job) {
  var self = this
    , infringements = null
    , engines = []
    ;

  logger.info('Verifying known torrent and cyberlocker ids');

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, 
  config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, collection) {
      infringements = collection;
      this();
    })
    .seq(function() {
      database.connectAndEnsureCollection('hosts', this);
    })
    .seq(function(hosts_){
      self.loadKnownEngines(hosts_, this);
    })
    .seq(function(loadedEngines){
      engines.add(loadedEngines);
      this();
    })    
    .set(engines)
    .seqEach(function(engine) {
      engine(infringements, this);
    })
    .seq(function() {
      logger.info('Completed verifying known ids');
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to mine links for %j: %s', campaign._id, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Verifier.prototype.loadKnownEngines = function(hosts, done) {
  var self = this
    , engines = []
  ;

  engines.push(self.torrentEngine.bind(self));
  

  hosts.find({ urlMatcher: { $exists: true }}, function(err, hostsWithMatcher){
    if(err)
      return done(err);
    hostsWithMatcher.each(function(hostWithMatcher){
      engines.push(self.cyberlockerEngine.bind(self, hostWithMatcher));
    });
    done(null, engines);
  });
}

Verifier.prototype.torrentEngine = function(infringements, done) {
  var self = this
    , verifiedhashes = []
    , needsVerifying = []
    , iStates = states.infringements.state
    ;

  logger.info('Starting Torrent engine');
  Seq()
    // Find verified torrent:// endpoints so we can get a list of hashes
    .seq(function() {
      var cur = infringements.find({ campaign: self.campaign_._id,
                                     scheme: 'torrent',
                                     state: { $in: [iStates.VERIFIED, iStates.SENT_NOTICE, iStates.TAKEN_DOWN ]},
                                     'children.count': 0
                                   },
                                   { uri: 1 });
      cur.toArray(this);
    })
    // From the torrent://foobarbaz, extract the hash for each one
    .seq(function(torrents) {
      torrents.forEach(function(torrent) {
        var hash = utilities.getDomain(torrent.uri);
        if (hash)
          verifiedhashes.push(hash);
      });
      this();
    })
    // Make the array of hashes our context
    .set(verifiedhashes)
    // For each hash, search for uris that have the hash in them and don't have a final state
    .seqEach(function(hash) {
      var that = this;

      logger.info('Searching for hash %s', hash);
      var cur = infringements.find({ campaign: self.campaign_._id,
                                     'children.count': 0,
                                     state: { $in: [ iStates.UNVERIFIED, iStates.NEEDS_DOWNLOAD ] },
                                     uri: new RegExp(hash, 'i')
                                   },
                                   { uri: 1 });
      cur.toArray(function(err, results) {
        if (err)
          return that(err);

        needsVerifying.add(results);
        that();
      });
    })
    // Set those as our context
    .set(needsVerifying)
    // Go through each one and mark as verified
    .seqEach(function(infringement) {
      logger.info('Setting state on %s', infringement.uri);
      self.infringements_.setStateBy(infringement, iStates.VERIFIED, 'verifier', this);
    })
    .seq(function() {
      logger.info('Torrent known id verifier finished');
      done();
    })
    .catch(function(err) {
      logger.warn('Unable to complete torrent known id verification: %s', err);
      done(err);
    })
    ;
}

Verifier.prototype.cyberlockerEngine = function(cyberlocker, infringements, done) {
  var self = this
    , verifiedIdObj = {}
    , verifiedIds = []
    , needsVerifying = []
    , iStates = states.infringements.state
    ;

  logger.info('Starting %s known id verifier', matcher.domain);

  Seq()
    .seq(function() {
      var cur = infringements.find({ campaign: self.campaign_._id,
                                     category: states.infringements.category.CYBERLOCKER,
                                     state: { $in: [iStates.VERIFIED, iStates.SENT_NOTICE, iStates.TAKEN_DOWN ]},
                                     'children.count': 0,
                                     uri: new RegExp(cyberlocker._id +'\/')
                                   },
                                   { uri: 1 });
      cur.toArray(this);
    })
    // Grab the unique id for the cyberlocker upload
    .seq(function(verified) {
      verified.forEach(function(infringement) {
        var id = infringement.uri.match(cyberlocker.urlMatcher);
        if (id)
          verifiedIdObj[id] = true;
      });
      // Just use a object in the middle so we don't search for the same id twice (or more)
      verifiedIds.add(Object.keys(verifiedIdObj));
      this();
    })
    // Now find matching, non verified, infringements for each id
    .seq(function() {
      var cur = infringements.find({ campaign: self.campaign_._id,
                                     category: states.infringements.category.CYBERLOCKER,
                                     state: { $in: [iStates.UNVERIFIED, iStates.NEEDS_DOWNLOAD ]},
                                     uri: new RegExp(cyberlocker._id +'\/')
                                   },
                                   { uri: 1 });
      cur.toArray(this);
    })
    // See if we can get a match of any of the ids on the unverified list
    .seq(function(unverified) {
      unverified.forEach(function(infringement) {
        var id = infringement.uri.match(cyberlocker.uriMatcher);
        
        if (verifiedIds.some(id))
          needsVerifying.push(infringement);
      });
      this();
    })
    // Set those as our context
    .set(needsVerifying)
    // Go through each one and mark as verified
    .seqEach(function(infringement) {
      logger.info('Setting state on %s', infringement.uri);
      self.infringements_.setStateBy(infringement, iStates.VERIFIED, 'verifier', this);
    })
    .seq(function() {
      logger.info('%s known-id verifier finished', cyberlocker._id);
      done();
    })
    .catch(function(err) {
      logger.warn('Unable to complete %s known-id verification: %s', cyberlocker._id, err);
      done(err);
    })
    ;
}

//
// Overrides
//
Verifier.prototype.getName = function() {
  return "verifier";
}


Verifier.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Verifier.prototype.end = function() {
  // Just let it finish as normal, it's pretty fast
}