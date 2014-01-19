/*
 * verifications.js: verification actions
 *
 * Wraps the verification actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('verifications.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Categories = states.infringements.category
  , Seq = require('seq')
  ;

/**
 * Wraps the verifications table.
 * 
 * @return {object}
 */
var Verifications = module.exports = function() {
  this.db_ = null;
  this.infringements_ = null;
  this.verifications_ = null;
  this.campaigns_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Verifications.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, infringements) {
      self.db_ = db;
      self.infringements_ = infringements;
      database.connectAndEnsureCollection('verifications', this);
    })
    .seq(function(db, verifications) {
      self.verifications_ = verifications;
      database.connectAndEnsureCollection('campaigns', this);
    })
    .seq(function(db, campaigns){
      self.campaigns_ = campaigns;
      this();
    })
    .seq(function() {
      self.cachedCalls_.forEach(function(call) {
        call[0].apply(self, call[1]);
      });
      self.cachedCalls_ = [];
    })
    .catch(function(err) {
      logger.warn('Unable to initialise %s', err);
    })
    ;
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

function normalizeCampaign(campaign) {
  if (campaign._id) {
    // It's an entire campaign row
    return campaign._id;
  } else {
    // It's just the _id.
    return campaign;
  }
}

function normalizeClient(client) {
 if (client._id) {
    // It's an entire client row
    return client._id;
  } else {
    // It's just the _id object
    return client;
  }
}


//
// Public Methods
//

/**
 * Get verifications for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {number}                skip             The number of documents to skip, for pagenation.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Verifications.prototype.getForCampaign = function(campaign, skip, limit, callback)
{
  var self = this
    , iStates = states.infringements.state
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: iStates.VERIFIED
  };

  var options = { 
    skip: skip, 
    limit: limit,
    sort: { 'points.total': -1, created: 1 }
  };

  self.infringements_.find(query, options).toArray(callback); 
}

/**
 * Get infringements count for a campaign at the specified points.
 *
 * @param {object}                 campaign         The campaign which we want unverified links for
 * @param {function(err,list)}     callback         A callback to receive the infringements, or an error;
 */
Verifications.prototype.getCountForCampaign = function(campaign, callback)
{
  var self = this
    , iStates = states.infringements.state
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getCountForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    verified: { 
      $exists: true
    },
    state: iStates.VERIFIED
  };

  self.infringements_.find(query).count(callback);
}

/**
 * Pop a infringement off the queue for verification.
 *
 * @param  {object}                       campaign    The campaign to find an infringement for to verify.
 * @param  {function(err,infringement)}   callback    A callback to receive the infringment, or null;
 * @return {undefined}
 */
Verifications.prototype.pop = function(campaign, callback) {
  var self = this;

  self.popSpecial(campaign, function(err, infringement) {
    if (err || !infringement) {
      if (err) logger.warn('Error getting special infringement: %s', err);

      self.popCyberlocker(campaign, function(err, infringement) {
        if (err || !infringement) {
          if (err) logger.warn('Error getting cyberlocker infringement: %s', err);
          return self.popBasic(campaign, callback);
        }
        callback(err, infringement);
      });
    } else {
      callback(err, infringement);
    }
  });
}

Verifications.prototype.popSpecial = function(campaign, callback) {
  var self = this
    , specials = campaign.metadata.specialHosts
    , then = Date.create('15 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.popSpecial, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  if (!specials || specials.length < 1)
    return callback();

  var string = "";
  specials.forEach(function(word) {
    string += ' ' + word;
  });

  var regex = new RegExp(utilities.buildLineRegexString(string, { anyWord: true }));
  console.log(regex);

  var query = {
    campaign: campaign,
    state: {
      $in: [states.infringements.state.NEEDS_DOWNLOAD, states.infringements.state.UNVERIFIED]
    },
    uri: regex,
    'children.count': 0,
    popped: {
      $lt: then
    }
  };

  var sort = [['state', -1], ['parents.count', -1 ], ['points.total', -1 ] ];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  var options = { new: true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);
}

Verifications.prototype.popCyberlocker = function(campaign, callback) {
  var self = this
    , name = campaign.name
    , then = Date.create('15 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.popCyberlocker, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    category: Categories.CYBERLOCKER,
    state: {
      $in : [states.infringements.state.NEEDS_DOWNLOAD, states.infringements.state.UNVERIFIED]
    },
    'children.count': 0,
    popped: {
      $lt: then
    }
  };

  var sort = [['state', -1], ['parents.count', -1 ], ['points.total', -1 ] ];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  var options = { new: true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);
}

Verifications.prototype.popBasic = function(campaign, callback) {
  var self = this
    , name = campaign.name
    , then = Date.create('15 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.pop, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    category: {
      $in: [Categories.WEBSITE, Categories.SOCIAL, Categories.FILE]
    },
    state: states.infringements.state.UNVERIFIED,
    'children.count': 0,
    popped: {
      $lt: then
    }
  };

  var sort = [['category', -1 ], ['parents.count', -1 ], ['points.total', -1 ], ['created', 1 ] ];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  var options = { new: true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);
}

/**
 * Pop a infringement off the queue for verification.
 *
 * @param  {object}                       campaign    The campaign to find an infringement for to verify.
 * @param  {function(err,infringement)}   callback    A callback to receive the infringment, or null;
 * @return {undefined}
 */
Verifications.prototype.popClient = function(client, callback) {
  var self = this
    , then = Date.create('30 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.pop, Object.values(arguments)]);

  client = normalizeClient(client);
  
  Seq()
    .seq(function(){
      self.campaigns_.find({ 'client': client._id }).toArray(this);
    })
    .seq(function(campaigns){
      var query = {
        'campaign': {$in : campaigns},
        category: {
          $in: [Categories.WEBSITE, Categories.SOCIAL, Categories.CYBERLOCKER, Categories.FILE]
        },
        state: states.infringements.state.UNVERIFIED,
        'children.count': 0,
        popped: {
          $lt: then
        }
      };

      var sort = [['category', -1 ], ['points.total', -1 ], ['created', 1 ] ];

      var updates = {
        $set: {
          popped: Date.now()
        }
      };

      var options = { new: true };

      self.infringements_.findAndModify(query, sort, updates, options, callback);
    })
    .catch(function(err){
      callback(err);
    })
    ;
}

/**
 * Pop a specific type of infringement off the queue for verification.
 *
 * @param  {object}                       campaign    The campaign to find an infringement for to verify.
 * @param  {array}                        types       Supported mimetypes.
 * @param  {string}                       [processor] Optionally restrict popping of an infringement if it's already been processed by processor.
 * @param  {function(err,infringement)}   callback    A callback to receive the infringment, or null;
 * @return {undefined}
 */
Verifications.prototype.popType = function(campaign, types, processor, callback) {
  var self = this
    , then = Date.create('30 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.popType, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.UNVERIFIED,
    'downloads.mimetype' : {
      $in: types
    },
    'children.count': 0,
    popped: {
      $lt: then
    }
  };

  var sort = [ ['parents.count', -1], ['points.total', -1], ['created', 1 ] ];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  if (processor) {
    query['metadata.processedBy'] = { $ne: processor };
  }

  var options = { new: true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);
}

/**
 * Get those infringements that need the verifier role to sort out endpoints
 *
 * @param {object}                campaign         The campaign which we want infringements from
 * @param {date}                  from             The time from which the infringements verified state should be gotten from.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Verifications.prototype.getThoseInNeedOfVerification = function(campaign, from, limit, callback)
{
  var self = this
    , iStates = states.infringements.state
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getVerifications, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    verified: { 
      $gte: from.getTime()
    },
    state: {
      $in: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.SENT_NOTICE, iStates.TAKEN_DOWN]
    }
  };

  var options = { 
    limit: limit,
    sort: { created: 1 }
  };

  self.infringements_.find(query, options).toArray(callback); 
}

/**
 * Get unverified parents for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {date}                  from             The time from which the verifications should be gotten.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Verifications.prototype.getAdoptedEndpoints = function(campaign, from, limit, callback)
{
  var self = this
    , iStates = states.infringements.state
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getAdoptedEndpoints, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    'parents.modified': { 
      $gte: from.getTime()
    },
    state: {
      $in: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.SENT_NOTICE, iStates.TAKEN_DOWN]
    }
  };

  var options = { 
    limit: limit,
    sort: { created: 1 }
  };

  self.infringements_.find(query, options).toArray(callback); 
}


/**
 * Verify a parent infringement.
 *
 * @param  {object}                       infringement    The infringement that has been verified.
 * @param  {number}                       state           The new state of the infringement.
 * @param  {function(err)}                callback        A callback to receive an error, if one occurs;
 * @return {undefined}
 */
Verifications.prototype.verifyParent = function(infringement, state, callback) {
  var self = this
    , iStates = states.infringements.state
    , stateNot = []
    ;

  if (!self.infringements_ || !self.verifications_)
    return self.cachedCalls_.push([self.verifyParent, Object.values(arguments)]);

  // Parent states should only be changed depending on certain conditions, so we 
  // have to build our tests for these conditions
  switch(state) {
    case iStates.UNAVAILABLE:
      // Don't change state if something has a important tag against it
      stateNot.push(iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.SENT_NOTICE, iStates.TAKEN_DOWN);
      break;

    case iStates.FALSE_POSITIVE:
      stateNot.push(iStates.VERIFIED, iStates.SENT_NOTICE, iStates.TAKEN_DOWN);
      break;

    case iStates.VERIFIED:
      stateNot.push(iStates.SENT_NOTICE, iStates.TAKEN_DOWN);
      break;

    case iStates.SENT_NOTICE:
    case iStates.TAKEN_DOWN: 
      // Should be same as verified and never propagated as-is
      stateNot.push(iStates.SENT_NOTICE, iStates.TAKEN_DOWN);
      state = iStates.VERIFIED;
      break;

    default:
      callback(new Error(util.format('State %d not supported for parent states', state)));
      break;
  }

   // Now update the infringement
  var query = {
    _id: infringement._id
  };

  if (stateNot.length) {
    query.state = { 
      $nin: stateNot
    }
  }

  var updates = {
    $set: {
      state: state,
      verified: Date.now()
    }
  };

  self.infringements_.update(query, updates, callback);
}

/**
 * Submit a verification of some sorts for a download - end of pipeline.
 * TODO refactor with options arg.
 * @param  {object}                       infringement    The infringement that has been verified
 * @param  {boolean}                      verified        Is this relevant
 * @param  {string}                       md5             Md5 of the download
 * @param  {int}                          trackId         Index into the campaign's track array (-1 signifying that you don't know)
 * @param  {float}                        score           Score returned from the autoverifier (-1 signifying that you don't know) 
 * @param  {boolean}                      isPurger        Is this the purger (then don't bump the count).
 * @param  {function(err)}                callback        A callback to receive an error, if one occurs
 * @return {undefined}
 */
 /*
Verifications.prototype.submit = function(infringement, verified, md5, trackId, score, isPurger, callback) {
  var self = this;

  if (!self.verifications_)
    return self.cachedCalls_.push([self.submit, Object.values(arguments)]);


  function doSubmit(err, verification){
    if(err)
      return callback(err)
    
    if(verification){
      // Check the same verdict was reached before and now
      if(verification.verified !== verified)
        logger.warn('Verification ' + JSON.stringify(verification._id) + ' has conflicting verified value to a previous submit');
      
      // Set the verified and score regardless (maybe its a correction)
      var update = {"$set" : { "verified" : verified,
                               "modified" : Date.now()
                              }};
      if(trackId >= 0)
        update["$set"].trackId = trackId;
      if(score >= 0)
        update["$set"].score = score;

      if(!isPurger){
        logger.info('We have seen this before on another infringement, bump the count and move on - md5 : ' + md5);
        update.merge({"$inc" : {"count" : 1}});
      }      
      self.verifications_.update({"_id.md5" : md5}, query, callback);
    }
    else{
      // not there already ? => insert a new one.
      var entity = {
        _id : {campaign : infringement.campaign,
               client : infringement.clientId,
               md5: md5},
        created : Date.now(),
        modified : Date.now(),
        verified: verified,
        score: scored,
        count : 1,
        assetNumber: trackId
      };

      self.verifications_.insert(entity, callback);
    }    
  }

  self.verifications_.findOne({_id: {campaign : infringement.campaign,
                                     client : infringement.client,
                                     md5 : md5}}, doSubmit); 
 }*/

/*
 * Bump the count on a given set of verifications
 * 
 */
Verifications.prototype.bumpCount = function(positiveVerifications, callback) {
  var self = this;
  var verificationMd5s = positiveVerifications.map(function(prev){return prev._id.md5});

  if (!self.verifications_)
    return self.cachedCalls_.push([self.bumpCount, Object.values(arguments)]);
  
  var md5s = [];
  verificationMd5s.each(function(md5){
    md5s.push({"_id.md5" : md5});
  });

  self.verifications_.update({$or : md5s}, {$inc : {count : 1}}, callback);
}

/* 
*  Assume we have checked to make sure that we don't have any other verifications
*  which have the same _id. 
*  At least supply -> { _id : {campaign : $id,
*                              client: $id, 
*                              md5 : ""}, 
*                       verified : true or false,
*                       score : }
*/
Verifications.prototype.create = function(entity, callback) {
  var self = this;

  if (!self.verifications_)
    return self.cachedCalls_.push([self.create, Object.values(arguments)]);
  
  var essentials = ["_id", "verified", "score"];
  var idEssentials = ['campaign', 'client', 'md5'];

  if(Object.keys(entity).intersect(essentials).length !== 3 &&
     Object.keys(entity._id).intersect(idEssentials).length !== 3){
    return callback(new Error("Not enough args - " + JSON.stringify(entity)));
  }

  // strip the assetNumber if false, irrelevant
  if(!entity.verified && Object.keys(entity).some('assetNumber'))
    delete entity.assetNumber;

  logger.info('About to add this verification ' + JSON.stringify(entity));
  self.verifications_.insert(entity, callback);
}

/**
 * Get verification(s) based on optional args
 *
 * @param  {object}                       options         The options hash
 * @param  {function(err)}                callback        A callback to receive an error, if one occurs
 * @return {undefined}
 */
Verifications.prototype.get = function(options, callback){
  var self = this;

  if (!self.verifications_)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  if(options.md5s){
    md5Query = [];
    options.md5s.each(function(md5){
      md5Query.push({"_id.md5" : md5});
    });
    //logger.info('about to query verifications with ' + JSON.stringify(md5Query));
    self.verifications_.find({$or : md5Query}).toArray(callback);
  }
  else if(options.campaign){
    var query = {};
    // Query with just a campaign and client
    Object.merge(query, {campaign : options.campaign._id});
    Object.merge(query, {client : options.campaign.client});
    self.verifications_.find({_id : query}).toArray(callback);
  }
}

/**
 * Attempts to grab verifications which are associated with the campaign and downloads
 * bumps the count on verifications that match and are verified.
 *
 * @param  {object}   campaign           The campaign in question.
 * @param  {object}   downloads          An array of download objects (from the infringement).
 * @param  {function} done               Exit point.
 */
Verifications.prototype.getRelevantAndBumpPositives = function(campaign, downloads, done){
  var self = this
    , query = {}
    ;

  if (!self.verifications_)
    return self.cachedCalls_.push([self.getRelevantAndBumpPositives, Object.values(arguments)]);    

  var md5s = downloads.map(function(download){return download.md5});
  var previousVerifications = [];

  Seq()
    .seq(function(){    
      self.get({"campaign" : campaign, "md5s": md5s}, this);
    })
    .seq(function(previousVerifications_){
      if(previousVerifications_.isEmpty()){
        logger.info('No recorded verifications for ' + JSON.stringify(md5s));
        return done();
      }
      previousVerifications = previousVerifications_;
      // We have verifications against these downloads, therefore weed out false positives and bump
      var positives = previousVerifications.filter(function(verif){ return verif.verified });
      self.bumpCount(positives, this);      
    })
    .seq(function(){
      done(null, previousVerifications);
    })
    .catch(function(err){
      done(err);
    })
    ;
}