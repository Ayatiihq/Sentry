/*
 * analytics.js: the analytics table
 *
 * Wraps the analytic table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , bcrypt = require('bcrypt')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('analytics.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq');

var COLLECTION = 'analytics';

/**
 * Wraps the analytics table.
 * 
 * @return {object}
 */
var Analytics = module.exports = function() {
  this.db_ = null;
  this.analytics = null;
  this.collections_ = [];

  this.cachedCalls_ = [];

  this.init();
}

Analytics.prototype.init = function() {
  var self = this;

  var requiredCollections = ['analytics', 'infringements', 'campaigns', 'hostBasicStats', 'hostLocationStats', 'linkStats'];

  Seq(requiredCollections)
    .seqEach(function(collectionName) {
      var that = this;

      database.connectAndEnsureCollection(collectionName, function(err, db, collection) {
        if (err)
          return that(err);

        self.db_ = db;
        self.collections_[collectionName] = collection;
        that();
      });
    })
    .seq(function() {
      self.cachedCalls_.forEach(function(call) {
        call[0].apply(self, call[1]);
      });
      self.cachedCalls_ = [];
    })
    .catch(function(err) {
      logger.error('Unable to connect to database %s', err);
    })
    ;
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

function normalizeCampaign(campaign) {
  if (Object.isString(campaign) && client.startsWith('{')) {
    // It's the _id of the campaign stringified
    return JSON.parse(campaign);
  } else if (campaign._id) {
    // It's an entire campaign row
    return campaign;
  } else {
    // It's just the _id object
    return { _id: campaign };
  }
}

function normalizeClient(client) {
  if (Object.isString(client) && client.startsWith('{')) {
    // It's the _id of the client stringified
    return JSON.parse(client);
  } else if (client._id) {
    // It's an entire client row
    return client;
  } else {
    // It's just the _id object
    return { _id: client };
  }
}

//
// Public Methods
//
/**
 * Get basic stats for a client
 *
 * @param {object}               client        The client to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getClientStats = function(client, callback) {
  var self = this
    , stats = {
      nInfringements: 0,
      nEndpoints: 0,
      nNotices: 0,
      nTotal: 0,
      nNeedsProcessing: 0,
      nNeedsDownload: 0
    }
    , iStates = states.infringements.state 
    , clientCampaigns = null
    ;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.infringements)
    return self.cachedCalls_.push([self.getClientStats, Object.values(arguments)]);

  client = normalizeClient(client);
  if (!client || !client._id)
    return callback(new Error('Valid client required'));

  Seq()
    .seq(function(){
      self.collections_.campaigns.find({ 'client': client._id }).toArray(this);
    })
    .par(function(campaigns_) {
      var that = this;
      clientCampaigns = campaigns_.map(function(campaign){return campaign._id});
      self.collections_.infringements.find({campaign : {$in : clientCampaigns},'state': { $in: [iStates.VERIFIED, iStates.SENT_NOTICE, iStates.TAKEN_DOWN ] } }).count(function(err, count) {
        stats.nInfringements = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = {campaign : {$in : clientCampaigns}, 'children.count': 0, 'state': { $nin: [iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.NEEDS_PROCESSING ] } }
        ;
      self.collections_.infringements.find(query).count(function(err, count) {
        stats.nEndpoints = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { campaign : {$in : clientCampaigns},
                    'state': {
                      $in: [ iStates.SENT_NOTICE, iStates.TAKEN_DOWN ]
                    }
                  }
        ;

      self.collections_.infringements.find(query).count(function(err, count) {
        stats.nNotices = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({campaign : {$in : clientCampaigns}, 'state': { $nin: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.DEFERRED ] } }).count(function(err, count) {
        stats.nTotal = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ campaign : {$in : clientCampaigns}, 'state': iStates.NEEDS_PROCESSING }).count(function(err, count) {
        stats.nNeedsProcessing = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ campaign : {$in : clientCampaigns}, 'state': iStates.NEEDS_DOWNLOAD }).count(function(err, count) {
        stats.nNeedsDownload = count ? count : 0;
        that(err);
      });
    })
    .seq(function() {
      callback(null, stats);
    })
    .catch(function(err) {
      callback(err, stats);
    })
    ;
}

/**
 * Get basic statistics for a campaign.
 *
 * @param  {object}              campaign      The campaign to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getCampaignStats = function(campaign, callback) {
  var self = this
    , stats = {
      nInfringements: 0,
      nEndpoints: 0,
      nNotices: 0,
      nTotal: 0,
      nNeedsProcessing: 0,
      nNeedsDownload: 0
    }
    , iStates = states.infringements.state 
    ;
  callback = callback ? callback : defaultCallback;

  if (!self.collections_.infringements)
    return self.cachedCalls_.push([self.getCampaignStats, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  if (!campaign || !campaign._id)
    return callback(new Error('Valid campaign required'));

  Seq()
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign': campaign._id, 'state': { $in: [iStates.VERIFIED, iStates.SENT_NOTICE, iStates.TAKEN_DOWN ] } }).count(function(err, count) {
        stats.nInfringements = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign': campaign._id, 'children.count': 0, 'state': { $nin: [iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.NEEDS_PROCESSING ] } }
        ;
      self.collections_.infringements.find(query).count(function(err, count) {
        stats.nEndpoints = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign' : campaign._id, 
                    'state': {
                      $in: [ iStates.SENT_NOTICE, iStates.TAKEN_DOWN ]
                    }
                  }
        ;

      self.collections_.infringements.find(query).count(function(err, count) {
        stats.nNotices = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign' : campaign._id, 'state': { $in: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.DEFERRED ] } }).count(function(err, count) {
        stats.nTotal = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign' : campaign._id, 'state': iStates.NEEDS_PROCESSING }).count(function(err, count) {
        stats.nNeedsProcessing = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign' : campaign._id, 'state': iStates.NEEDS_DOWNLOAD }).count(function(err, count) {
        stats.nNeedsDownload = count ? count : 0;
        that(err);
      });
    })
    .seq(function() {
      callback(null, stats);
    })
    .catch(function(err) {
      callback(err, stats);
    })
    ;
}

/**
 * Get analytics for a campaign.
 *
 * @param  {object}              campaign      The campaign to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getCampaignAnalytics = function(campaign, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.analytics)
    return self.cachedCalls_.push([self.getCampaignAnalytics, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  if (!campaign || !campaign._id)
    return callback(new Error('Valid campaign required'));

  self.collections_.analytics.find({ '_id.campaign': campaign._id }).toArray(function(err, docs) {
    if (err)
      return callback(err);

    var stats = {};

    docs.forEach(function(doc) {
      stats[doc._id.statistic] = doc.value;
    });

    callback(null, stats);
  });
}

/**
 * Get analytics for a client.
 *
 * @param  {object}              client      The client to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getClientAnalytics = function(client, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.analytics)
    return self.cachedCalls_.push([self.getClientAnalytics, Object.values(arguments)]);

  client = normalizeClient(client);
  if (!client || !client._id)
    return callback(new Error('Valid client required'));
  Seq()
    .seq(function(){
      self.collections_.campaigns.find({ 'client': client._id }).toArray(this);
    })
    .seq(function(campaigns_) {
      var that = this;
      var clientCampaigns = campaigns_.map(function(campaign){return campaign._id});

      self.collections_.analytics.find({ '_id': {$in : clientCampaigns }}).toArray(function(err, docs) {
        if (err)
          return that(err);

        var stats = {};

        docs.forEach(function(doc) {
          stats[doc._id.statistic] = doc.value;
        });
        callback(null, stats);
      });
    })
    .catch(function(err){
      callback(err);
    })
    ;
}

/**
 * Get country data for a campaign.
 *
 * @param  {object}              campaign      The campaign to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getCampaignCountryData = function(campaign, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.hostLocationStats)
    return self.cachedCalls_.push([self.getCampaignCountryData, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  if (!campaign || !campaign._id)
    return callback(new Error('Valid campaign required'));

  self.collections_.hostLocationStats.find({ '_id.campaign': campaign._id, '_id.regionName': { $exists: false } }).toArray(callback);
}

/**
 * Get country data for a client.
 *
 * @param  {object}              campaign      The campaign to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getClientCountryData = function(client, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.hostLocationStats)
    return self.cachedCalls_.push([self.getClientCountryData, Object.values(arguments)]);

  client = normalizeClient(client);
  if (!client || !client._id)
    return callback(new Error('Valid client required'));

  self.collections_.hostLocationStats.find({ '_id.client': client._id, '_id.regionName': { $exists: false } }).toArray(callback);
}

/**
 * Get work done timeseries for client
 */
Analytics.prototype.getClientWorkTimeSeries = function(client, callback) {
  var self = this;
  
  callback = callback ? callback : defaultCallback;

  if (!self.collections_.linkStats)
    return self.cachedCalls_.push([self.getClientWorkTimeSeries, Object.values(arguments)]);

  client = normalizeClient(client);
  if (!client || !client._id)
    return callback(new Error('Valid client required'));

  var query = { '_id.client': client._id, '_id.timestamp': { $exists: true }, '_id.category': { $exists: false } };
  self.collections_.linkStats.find(query).sort({ '_id.timestamp': -1 }).limit(6).toArray(callback);
}

/**
 * Get work done timeseries for client
 */
Analytics.prototype.getCampaignWorkTimeSeries = function(campaign, callback) {
  var self = this;
  
  callback = callback ? callback : defaultCallback;

  if (!self.collections_.linkStats)
    return self.cachedCalls_.push([self.getCampaignWorkTimeSeries, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  if (!campaign || !campaign._id)
    return callback(new Error('Valid campaign required'));

  var query = { '_id.campaign': campaign._id, '_id.timestamp': { $exists: true }, '_id.category': { $exists: false } };
  self.collections_.linkStats.find(query).sort({ '_id.timestamp': -1 }).limit(6).toArray(callback);
}