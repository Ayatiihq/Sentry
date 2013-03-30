/*
 * campaigns.js: the campaigns table
 *
 * Wraps the campaigns table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('campaigns.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var COLLECTION = 'campaigns';

/**
 * Wraps the campaigns table.
 * 
 * @return {object}
 */
var Campaigns = module.exports = function() {
  this.db_ = null;
  this.campaigns_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Campaigns.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.campaigns_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}

//
// Public Methods
//
/**
 * Get a list of campaigns.
 *
 * @param {function(err, roles)} callback The callback to consume the campaigns.
 * @return {undefined}
 */
Campaigns.prototype.listCampaigns = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;
  
  if (!self.campaigns_)
    return self.cachedCalls_.push([self.listCampaigns, Object.values(arguments)]);

  self.campaigns_.find().toArray(callback);
}

/**
 * Get a list of active campaigns.
 *
 * @param {function(err,campaigns)} callback The callback to consume the campaigns.
 * @return {undefined}
 */
Campaigns.prototype.listActiveCampaigns = function(callback) {
  var self = this
    , now = Date.now()
    ;
  
  if (!self.campaigns_)
    return self.cachedCalls_.push([self.listActiveCampaigns, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var query = {
    sweep: true,
    sweepFrom: { $lt: now },
    sweepTo: { $gt: now }
  };
  self.campaigns_.find(query).toArray(callback);
}

/**
 * Get a campaign's details.
 *
 * @param {string}                    id          The campaign id;
 * @param {function(err, campaign)}    callback    The campaign details, or error.
 * @return {undefined}
 */
Campaigns.prototype.getDetails = function(id, callback) {
  var self = this;

  if (!self.campaigns_)
    return self.cachedCalls_.push([self.getDetails, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;
  id = Object.isString(id) ? JSON.parse(id) : id;

  self.campaigns_.findOne({ _id: id }, callback);
}

/**
 * Adds a campaign.
 *
 * @param {object}          campaign     An object containing details of the campaign.
 * @param {function(err,campaign)}   callback   A callback to receive an error, if one occurs, otherwise the new campaign.
 * @return {undefined}
 */
Campaigns.prototype.add = function(campaign, callback) {
  var self = this
    , now = Date.utc.create().getTime()
    ;
  
  callback = callback ? callback : defaultCallback;

  if (!(campaign && campaign.client && campaign.name && campaign.type)) { 
    callback(new Error('campaign should exist & have name and type'));
    return;
  }

  if (!self.campaigns_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  campaign._id = {
    client: campaign.client,
    campaign: campaign.name
  };
  campaign.name = campaign.name;
  campaign.type = campaign.type;
  campaign.description = ifUndefined(campaign.description, '');
  campaign.avatar = ifUndefined(campaign.avatar, '');
  campaign.created = now;
  campaign.sweep = ifUndefined(campaign.sweep, false);
  campaign.sweepFrom = ifUndefined(campaign.sweepFrom, now);
  campaign.sweepTo = ifUndefined(campaign.sweepTo, Date.utc.create('two weeks from now').getTime());
  campaign.sweepIntervalMinutes = ifUndefined(campaign.sweepIntervalMinutes, 180);
  campaign.names = ifUndefined(campaign.names, []);
  campaign.metadata = ifUndefined(campaign.metadata, {});
  campaign.scrapersEnabled = ifUndefined(campaign.scrapersEnabled, []);
  campaign.scrapersIgnored = ifUndefined(campaign.scrapersIgnored,  []);

  self.campaigns_.insert(campaign, callback);
}

/**
 * Update a campaign's details.
 *
 * @param {object}          id      The id selecting the client.
 * @param {object}          updates    An object containing updates for the campaign.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Campaigns.prototype.update = function(id, updates, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.campaigns_)
    return self.cachedCalls_.push([self.update, Object.values(arguments)]);

  self.campaigns_.update({ _id: id }, { $set: updates }, callback);
}

/**
 * Remove a campaign.
 *
 * @param {object}          id      The id selecting the client(s).
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Campaigns.prototype.remove = function(id, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.campaigns_)
    return self.cachedCalls_.push([self.remove, Object.values(arguments)]);

  self.campaigns_.remove({ _id: id }, callback);
}