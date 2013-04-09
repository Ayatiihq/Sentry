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
      self.verifications = verifications;
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
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: 0,
    'children.count': 0
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
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getCountForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: 0,
    'children.count': 0
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