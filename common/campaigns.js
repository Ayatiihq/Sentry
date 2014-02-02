/*
 * campaigns.js: the campaigns table
 *
 * Wraps the campaigns table.
 * 
 {
  "_id": "",
  "avatar": "",
  "client": "",
  "created": 0,
  "description": "",
  "heartBeats": {
    Date: 0,
    Date: 0
    ...
  },
  "metadata": {
    "albumTitle": "",
    "artist": "",
    "blacklist": [
      ""
    ],
    "catNo" : ""
    "duration" : 0,
    "engineKeywords": [
      ""
    ],
    "label" : "",
    "language": "",
    "lowPriorityWordList": [
      ""
    ],
    "mbReleaseId" : "",
    "releaseDate": "",
    "searchengineMaxPages": 0,
    "soundtrack": false,
    "assets": [ 
      {
        "altTitles": [""],
        "artist": [
          ""
        ],
        "duration": 0, // in seconds
        "mbTrackId": "",
        "md5": "", 
        "noSearch": false,
        "number": [0-assets.Length],
        "title": "" 
      }
      .
      .
      .
    ],
    "url": "",
    "year": ""
  },
  "name": "", // // always assume this is the correct title (via musicbrainz according to release)
  "names": [],
  "priority": 0,
  "scrapersEnabled": []
  "scrapersIgnored": [],
  "sweep": true,
  "sweepFrom": 0,
  "sweepIntervalMinutes": 0,
  "sweepTo": 0,
  "type": ""
}
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('campaigns.js')
  , sugar = require('sugar')
  , util = require('util')
  , utilities = acquire('utilities')
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

/**
 * Define the 'static' list of campaign types that we should use for various campaign types
 */
Campaigns.types = function() {
  // add new campaign types as we add support for them.
  return ['music', 'music.album', 'music.track', 'movie', 'tv.live', 'tv.series'];
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
 * Get a list of campaigns for a client.
 *
 * @param  {string}                    client      The client.
 * @param  {function(err,campaigns)}   callback    The callback to consume the campaigns.
 * @return {undefined}
 */
Campaigns.prototype.listCampaignsForClient = function(client, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;
  
  if (!self.campaigns_)
    return self.cachedCalls_.push([self.listCampaignsForClient, Object.values(arguments)]);

  self.campaigns_.find({ 'client': client }).toArray(callback);
}

/**
 * Get a campaign's details.
 *
 * @param {string}                     id          The campaign id;
 * @param {function(err, campaign)}    callback    The campaign details, or error.
 * @return {undefined}
 */
Campaigns.prototype.getDetails = function(id, callback) {
  var self = this;

  if (!self.campaigns_)
    return self.cachedCalls_.push([self.getDetails, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.campaigns_.findOne({ _id: id }, callback);
}

/**
 * Adds a campaign.
 *
 * @param {object}                   campaign   An object containing details of the campaign.
 * @param {function(err,campaign)}   callback   A callback to receive an error, if one occurs, otherwise the new campaign.
 * @return {undefined}
 */
Campaigns.prototype.add = function(campaign, callback) {
  var self = this
    , now = Date.now()
    ;
  
  callback = callback ? callback : defaultCallback;

  if (!(campaign && campaign.client && campaign.name && campaign.type)) { 
    callback(new Error('campaign should exist & have name and type'));
    return;
  }

  if (!self.campaigns_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  campaign._id = utilities.genLinkKey(campaign.client,
                                      campaign.name,
                                      Date.now());
  campaign.name = campaign.name;
  campaign.type = campaign.type;
  campaign.description = ifUndefined(campaign.description, '');
  campaign.avatar = ifUndefined(campaign.avatar, '');
  campaign.created = now;
  campaign.sweep = ifUndefined(campaign.sweep, false);
  campaign.sweepFrom = ifUndefined(campaign.sweepFrom, now);
  campaign.sweepTo = ifUndefined(campaign.sweepTo, Date.utc.create('four weeks from now').getTime());
  campaign.sweepIntervalMinutes = ifUndefined(campaign.sweepIntervalMinutes, 60);
  campaign.names = ifUndefined(campaign.names, []);
  campaign.metadata = ifUndefined(campaign.metadata, {});
  campaign.scrapersEnabled = ifUndefined(campaign.scrapersEnabled, []);
  campaign.scrapersIgnored = ifUndefined(campaign.scrapersIgnored,  []);

  self.campaigns_.insert(campaign, callback);
}

/**
 * Update a campaign's details.
 *
 * @param {object}          id         The id selecting the client.
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
 * @param {object}          id         The id selecting the client(s).
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

Campaigns.prototype.save = function(campaign, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;
  
  if (!self.campaigns_)
    return self.cachedCalls_.push([self.save, Object.values(arguments)]);

  self.campaigns_.save(campaign, callback);
}

/**
 * Turn a campaign off or on.
 * @param {string}          id            The id selecting the campaign.
 * @param {boolean}         value         Off or On.
 * @param {function(err)}   callback      A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Campaigns.prototype.sweep = function(id, update, callback){
  var self = this;

  callback = callback ? callback : defaultCallback;
  
  if (!self.campaigns_)
    return self.cachedCalls_.push([self.sweep, Object.values(arguments)]);

  self.campaigns_.update({_id : id}, { $set: {'sweep' : update} }, callback);
}
