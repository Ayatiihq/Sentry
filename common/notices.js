/*
 * notices.js: notice actions
 *
 * Wraps the notice actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('notices.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq');

/**
 * Wraps the notices table.
 * 
 * @return {object}
 */
var Notices = module.exports = function() {
  this.db_ = null;
  this.infringements_ = null;
  this.notices_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Notices.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, infringements) {
      self.db_ = db;
      self.infringements_ = infringements;
      database.connectAndEnsureCollection('notices', this);
    })
    .seq(function(db, notices) {
      self.notices_ = notices;
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
 * Get's all infringements that are ready for notice sending.
 *
 * @param {object}                campaign         The campaign
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Notices.prototype.getReadyForNotice = function(campaign, callback)
{
  var self = this
    , iStates = states.infringements.state
    , results = []
    , skip = 0
    , limit = 1000
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getReadyForNotice, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: iStates.VERIFIED,
    noticed: {
      $exists: false
    },
    scheme: {
      $nin: ['torrent']
    }
  };

  var options = { 
    skip: skip, 
    limit: limit
  };

  function getNotices() {

    self.infringements_.find(query, options).toArray(function(err, docs) {
      if (err)
        return callback(err, results);

      if (docs.length) {
        results = results.add(docs);
        options.skip += docs.length;
        getNotices();
      } else {
        callback(null, results);
      }
    }); 
  }

  getNotices();
}