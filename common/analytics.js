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
  this.infringements = null;

  this.collections_ = [];

  this.cachedCalls_ = [];

  this.init();
}

Analytics.prototype.init = function() {
  var self = this;

  var requiredCollections = ['analytics', 'infringements', 'hostBasicStats', 'hostLocationStats'];

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
    ;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.infringements)
    return self.cachedCalls_.push([self.getClientStats, Object.values(arguments)]);

  if (!client || !client._id)
    return callback(new Error('Valid client required'));

  Seq()
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign.client': client._id, 'state': { $in: [iStates.VERIFIED, iStates.SENT_NOTICE, iStates.TAKEN_DOWN ] } }).count(function(err, count) {
        stats.nInfringements = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign.client': client._id, 'children.count': 0, 'state': { $nin: [iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.NEEDS_PROCESSING ] } }
        ;
      self.collections_.infringements.find(query).count(function(err, count) {
        stats.nEndpoints = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign.client': client._id, 
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
      self.collections_.infringements.find({ 'campaign.client': client._id, 'state': { $nin: [iStates.VERIFIED, iStates.FALSE_POSITIVE, iStates.UNAVAILABLE, iStates.DEFERRED ] } }).count(function(err, count) {
        stats.nTotal = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign.client': client._id, 'state': iStates.NEEDS_PROCESSING }).count(function(err, count) {
        stats.nNeedsProcessing = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this;
      self.collections_.infringements.find({ 'campaign.client': client._id, 'state': iStates.NEEDS_DOWNLOAD }).count(function(err, count) {
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
 * Get country data for a campaign.
 *
 * @param  {object}              campaign      The campaign to find stats for.
 * @param  {function(err,stats)} callback      The callback to consume the stats, or an error.
 * @return {undefined}
 */
Analytics.prototype.getCampaignCountryData = function(campaign, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.collections_.analytics)
    return self.cachedCalls_.push([self.getCampaignCountryData, Object.values(arguments)]);

  if (!campaign || !campaign._id)
    return callback(new Error('Valid campaign required'));

  self.collections_.hostLocationStats.find({ '_id.campaign': campaign._id, '_id.regionName': { $exists: false } }).toArray(callback);
}