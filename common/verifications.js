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
  ;

var Seq = require('seq');

/**
 * Wraps the verifications table.
 * 
 * @return {object}
 */
var Verifications = module.exports = function() {
  this.db_ = null;
  this.infringements_ = null;
  this.verifications_ = null;

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
  if (Object.isString(campaign)) {
    // It's the _id of the campaign stringified
    return JSON.parse(campaign);
  } else if (campaign._id) {
    // It's an entire campaign row
    return campaign._id;
  } else {
    // It's just the _id object
    return campaign;
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
    verified: { 
      $exists: true
    },
    state: {
      $nin: [iStates.UNVERIFIED, iStates.FALSE_POSITIVE, iStates.DEFERRED, iStates.UNAVAILABLE ]
    }
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
    state: {
      $nin: [iStates.UNVERIFIED, iStates.FALSE_POSITIVE, iStates.DEFERRED, iStates.UNAVAILABLE ]
    }
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
  var self = this
    , then = Date.create('30 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.pop, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.UNVERIFIED,
    'children.count': 0,
    popped: {
      $lt: then
    }
  };

  var sort = [ ['points.total', -1], ['created', 1 ] ];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  var options = { new: true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);
}

/**
 * Submit a verification for an infringement.
 *
 * @param  {object}                       infringement    The infringement that has been verified.
 * @param  {object}                       verification    The verification result of the infringement.
 * @param  {function(err)}                callback        A callback to receive an error, if one occurs;
 * @return {undefined}
 */
Verifications.prototype.submit = function(infringement, verification, callback) {
  var self = this;

  if (!self.infringements_ || !self.verifications_)
    return self.cachedCalls_.push([self.submit, Object.values(arguments)]);

  // First add the verification to the verifications table. Do an upsert because we're cool
  verification.created = Date.now();

  var updates = {
    $push: { 
      verifications: verification
    }
  };

  var options = { upsert: true };

  self.verifications_.update({ _id: infringement._id }, updates, options, function(err) {
    if (err)
      return callback(err);

    // Now update the infringement
    var query = {
      _id: infringement._id,
      state: states.infringements.state.UNVERIFIED
    };

    var updates = {
      $set: {
        state: verification.state,
        verified: Date.now()
      }
    };

    self.infringements_.update(query, updates, callback);
  });
}

/**
 * Get verifications for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {date}                  from             The time from which the verifications should be gotten.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Verifications.prototype.getVerifications = function(campaign, from, limit, callback)
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
      $in: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE]
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
      $in: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE]
    }
  };

  var options = { 
    limit: limit,
    sort: { created: 1 }
  };

  console.log(query);
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
      stateNot.push[iStates.VERIFIED, iStates.FALSE_POSITIVE];
      break;

    case iStates.FALSE_POSITIVE:
      stateNot.push[iStates.VERIFIED];
      break;

    case iStates.VERIFIED:
      // Verified trumps everything
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