/*
 * notices.js: notice actions
 *
 * Wraps the notice actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */
require('sugar');
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


function normalizeClient(campaign) {
 if (campaign._id) {
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

/**
 * Adds a new notice.
 *
 * @param {object}               campaign   The campaign that the notice belongs to.
 * @param {object}               notice     The notice .
 * @param {function(err, doc)}   callback   A callback to receive an error, if one occurs, otherwise the inserted documents.
 * @return {undefined}
 */
Notices.prototype.add = function(campaign, notice, callback) {
  var self = this;

  if (!self.notices_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  callback = callback ? callback : defaultCallback;

  notice.campaign = campaign;
  notice.created = Date.now();
  notice.state = states.notices.state.PENDING;

  Seq(notice.infringements)
    .seqEach(function(infringement) {
      self.updateInfringement(notice, infringement, this.ok);
    })
    .seq(function() {
      self.notices_.insert(notice, this);
    })
    .seq(function() {
      callback();
    })
    .catch(function(err) {
      callback(err);
    })
    ;
}

/**
 * Updates an infringement with notice details.
 *
 * @param {object}          notices        The notice this infringement is referenced in.
 * @param {object}          infringement   The infringement to update.
 * @param {function(err)}   callback       A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Notices.prototype.updateInfringement = function(notice, infringement, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.updateInfringement, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $set: {
      noticed: notice.created,
      noticeId: notice._id,
      state: states.infringements.state.SENT_NOTICE
    }
  };

  self.infringements_.update({ _id: infringement }, updates, callback);
}

/**
 * Sets a notice and it's infringements to the 'taken down' state
 *
 * @param  {object}          notice      A valid notice
 * @param  {function(err)}   callback    A callback to receive an error, if one occurs
 * @return {undefined}
 */
Notices.prototype.setTakenDown = function(notice, callback) {
  var self = this;

  if (!self.infringements_ || !self.notices_)
    return self.cachedCalls_.push([self.setTakenDown, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.notices_.findOne(notice, function(err, notice) {
    Seq(notice.infringements)
      .seqEach(function(infringementId) {
        logger.info('Setting %s to taken-down', infringementId);
        self.infringements_.update({ _id: infringementId },
                                   { $set: { state: states.infringements.state.TAKEN_DOWN } },
                                    this.ok);
      })
      .seq(function() {
        logger.info('Setting notice %s to accepted', notice._id);
        self.notices_.update({ _id: notice._id },
                            {
                              $set: {
                                state: states.notices.state.PROCESSED
                              }
                            },
                            this);
      })
      .seq(function() {
        callback();
      })
      .catch(function(err) {
        callback(err);
      });
  });
}

/**
 * Get notices for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {number}                skip             The number of documents to skip, for pagenation.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the notices, or an error;
*/
Notices.prototype.getForCampaign = function(campaign, options, callback)
{
  var self = this;

  if (!self.notices_)
    return self.cachedCalls_.push([self.getForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign
  };

  var options = { 
    skip: options.skip, 
    limit: options.limit,
    sort: { created: -1 }
  };

  if (options.after) {
    query.created = { $gt: options.after };
  }

  if (options.search && options.search.length > 3) {
    query.host = new RegExp('(' + options.search.replace(/\ /gi, '|') + ')', 'i');
  }

  self.notices_.find(query, options).toArray(callback); 
}

/**
 * Get notices count for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {object}                options          Options for the count.
 * @param {function(err,list)}    callback         A callback to receive the notices, or an error;
 */
Notices.prototype.getCountForCampaign = function(campaign, options, callback)
{
  var self = this;

  if (!self.notices_)
    return self.cachedCalls_.push([self.getCountForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign
  };

  if (options.after) {
    query.created = { $gt: options.after };
  }

  if (options.search && options.search.length > 3) {
    query.host = new RegExp('(' + options.search.replace(/\ /gi, '|') + ')', 'i');
  }

  self.notices_.find(query).count(callback);
}

/**
 * Get Pending notices for a campaign within a certain time span.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {integer}               rangeStart       Number of days ago from which to start
 * @param {integer}               rangeEnd         Number of days ago from which to end
 * @param {function(err,list)}    callback         A callback to receive the notices, or an error;
 */
Notices.prototype.getPendingForCampaign = function(campaign, rangeStart, rangeEnd, callback)
{
  var self = this;

  if (!self.notices_)
    return self.cachedCalls_.push([self.getPendingForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: 0,
    created: {$gt: (rangeStart).daysAgo().getTime(), $lt: (rangeEnd).daysAgo().getTime()}
  };

  var options = {
    sort: { created: -1 }
  };

  self.notices_.find(query, options).toArray(callback);
}

/**
 * Get notices for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {number}                skip             The number of documents to skip, for pagenation.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the notices, or an error;
*/
Notices.prototype.getForClient = function(client, options, callback)
{
  var self = this;

  if (!self.notices_)
    return self.cachedCalls_.push([self.getForClient, Object.values(arguments)]);

  client = normalizeClient(client);

  var query = {
    'campaign.client': client
  };

  var options = { 
    skip: options.skip, 
    limit: options.limit,
    sort: { created: -1 }
  };

  self.notices_.find(query, options).toArray(callback); 
}

/**
 * Get notices count for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {object}                options          Options for the count.
 * @param {function(err,list)}    callback         A callback to receive the notices, or an error;
 */
Notices.prototype.getCountForClient = function(client, options, callback)
{
  var self = this;

  if (!self.notices_)
    return self.cachedCalls_.push([self.getCountForClient, Object.values(arguments)]);

  client = normalizeClient(client);

  var query = {
    'campaign.client': client
  };

  self.notices_.find(query).count(callback);
}

