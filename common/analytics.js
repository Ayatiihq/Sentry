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
  this.analytics_ = null;
  this.infringements_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Analytics.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('analytics', this);
    })
    .seq(function(db, analytics) {
      self.db_ = db;
      self.analytics_ = analytics;

      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, infringements) {
      self.infringements_ = infringements;
      this();
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
      nNotices: 0
    } 
    ;

  callback = callback ? callback : defaultCallback;

  if (!self.analytics_)
    return self.cachedCalls_.push([self.getClientStats, Object.values(arguments)]);

  if (!client || !client._id)
    return callback(new Error('Valid client required'));

  Seq()
    .par(function() {
      var that = this;
      self.infringements_.find({ 'campaign.client': client._id }).count(function(err, count) {
        stats.nInfringements = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign.client': client._id, 'children.count': 0 }
        ;
      self.infringements_.find(query).count(function(err, count) {
        stats.nEndpoints = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign.client': client._id, 'state': states.infringements.state.SENT_NOTICE }
        ,

      self.infringements_.find(query).count(function(err, count) {
        stats.nNotices = count ? count : 0;
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
      nNotices: 0
    } 
    ;
  callback = callback ? callback : defaultCallback;

  if (!self.analytics_)
    return self.cachedCalls_.push([self.getCampaignStats, Object.values(arguments)]);

  if (!campaign || !campaign._id)
    return callback(new Error('Valid campaign required'));

  Seq()
    .par(function() {
      var that = this;
      self.infringements_.find({ 'campaign': campaign._id }).count(function(err, count) {
        stats.nInfringements = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign': campaign._id, 'children.count': 0 }
        ;
      self.infringements_.find(query).count(function(err, count) {
        stats.nEndpoints = count ? count : 0;
        that(err);
      });
    })
    .par(function() {
      var that = this
        , query = { 'campaign' : campaign._id, 'state': states.infringements.state.SENT_NOTICE }
        ,

      self.infringements_.find(query).count(function(err, count) {
        stats.nNotices = count ? count : 0;
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