/*
 * infringements.js: the infringements table
 *
 * Wraps the infringements table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('infringements.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  , utilities = require('./utilities')
  ;

var COLLECTION = 'infringements'
  , EDUPLICATE = 11000
  ;

/**
 * Wraps the infringements table.
 * 
 * @return {object}
 */
var Infringements = module.exports = function() {
  this.infringements_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Infringements.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.infringements_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

function defaultCallback(err) {
  if (err && err.code !== 'EntityAlreadyExists')
    logger.warn('Reply Error: %s', err.message);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
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
 * Generates a unique key for the campaign, uri and optional metadata.
 *
 * @param {stringOrObject}     campaign    The campaign the uri infringement belongs to.
 * @param {string}             uri         The uri to add.
 * @param {string}             [metadata]  Optional metadata for uri.
 * @return {string}                        The unique key.
 */
Infringements.prototype.generateKey = function(campaign, uri, metadata) {
  campaign = normalizeCampaign(campaign);
  return utilities.genLinkKey(JSON.stringify(campaign), uri, metadata);
}

/**
 * Add a infringement for the campaign.
 *
 * @param  {stringOrObject}    campaign    The campaign the URI belongs to.
 * @param  {string}            uri         The uri to add.
 * @param  {string}            type        The type of uri.
 * @param  {string}            source      The source of this infringement.
 * @param  {object}            pointsEntry The points (rating) of this infringment (to signify how 'hot' this infringment is)
 * @param  {object}            metadata    Any metadata belonging to this infringement.
 * @param  {function(err,uid)} callback    A callback to receive the uid of the uri, or an error.
 * @return {undefined}
 */
Infringements.prototype.add = function(campaign, uri, type, source, state, pointsEntry, metadata, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  callback = callback ? callback : defaultCallback;
  uri = utilities.normalizeURI(uri);
  pointsEntry.created = Date.now();

  var entity = {};
  entity._id = self.generateKey(campaign, uri);
  entity.campaign = campaign;
  entity.uri = uri;
  entity.scheme = utilities.getURIScheme(uri);
  entity.type = type;
  entity.source = source;
  entity.state = states.NEEDS_PROCESSING;
  entity.created = Date.now();
  entity.points = {
    total: pointsEntry.score ? pointsEntry.score : 0,
    modified: Date.now(),
    entries: [ pointsEntry ]
  };
  entity.metadata = metadata;
  entity.parents = { count: 0, uris: [] };
  entity.children = { count: 0, uris: [] };

  self.infringements_.insert(entity, function(err) {
    if (!err || err.code === EDUPLICATE)
      callback(null, entity._id);
    else
      callback(err);
  });
}

/**
 * Add a meta infringement (an infringement that doesn't have a unique URI of it's own). A
 * relationship between the meta infringement and the original uri is automatically added.
 *
 * @param {stringOrObject}    campaign    The campaign the infringement belongs to.
 * @param {string}            uri         The uri that contains the infringement.
 * @param {string}            source      The source of the meta infringement (google, bing, etc).
 * @param {object}            metadata    Metadata about the infringement.
 * @param {function(err,uid)} callback    Callback to receive the uid of the infringement, or an error.
 * @return {undefined}
 */
Infringements.prototype.addMeta = function(campaign, uri, type, source, state, metadata, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addMeta, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  uri = utilities.normalizeURI(uri);
  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity._id = self.generateKey(campaign, uri, source);
  entity.campaign = campaign;
  entity.uri = uri;
  entity.scheme = utilities.getURIScheme(uri);
  entity.type = type;
  entity.meta = true;
  entity.source = source;
  entity.state = states.NEEDS_PROCESSING;
  entity.created = Date.now();
  entity.points = {
    total: 0,
    modified: Date.now(),
    entries: []
  };
  entity.metadata = metadata;
  entity.parents = { count: 0, uris: [] };
  entity.children = { count: 0, uris: [] };

  self.infringements_.insert(entity, function(err) {
    if (!err || err.code === EDUPLICATE) {
      self.addMetaRelation(campaign, uri, source);
      callback(null, entity._id);
    }
    else
      callback(err);
  });
}

/**
 * Adds a parent -> child relationship between uris.
 *
 * @param {stringOrObject}    campaign    The campaign the uris belong to.
 * @param {string}            parent      The parent URI.
 * @param {string}            child       The child URI.
 * @param {function(err)}     callback    A callback to handle errors.
 * @return {undefined}   
 */
Infringements.prototype.addRelation = function(campaign, parent, child, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addRelation, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  parent = utilities.normalizeURI(parent);
  child = utilities.normalizeURI(child);
  callback = callback ? callback : defaultCallback;

  if (parent === child)
    return callback();

  // Set the forward link, only find documents that don't have the child already in
  var query = {
        _id: self.generateKey(campaign, parent),
        'children.uris': {
          $nin: [ child ]
        }
      }
    , updates = {
        $inc: { 'children.count': 1 },
        $set: { 'children.modified': Date.now() },
        $addToSet: { 'children.uris': child }
      }
    ;
  
  self.infringements_.update(query, updates, defaultCallback);

  // Set the reverse link
  query = {
    _id: self.generateKey(campaign, child),
    'parents.uris': {
       $nin: [ parent ]
    }
  };
  updates = {
    $inc: { 'parents.count': 1 },
    $set: { 'parents.modified': Date.now() },
    $addToSet: { 'parents.uris': parent }
  };
  
  self.infringements_.update(query, updates, callback);
}

/**
 * Adds a parent -> child relationship between uris where source is a meta link.
 *
 * @param {stringOrObject}    campaign    The campaign the uris belong to.
 * @param {string}            uri         The uri.
 * @param {string}            source      The source of the meta infringement (google, bing, etc).
 * @param {function(err)}     callback    A callback to handle errors.
 * @return {undefined}   
 */
Infringements.prototype.addMetaRelation = function(campaign, uri, owner, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addMetaRelation, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  uri = utilities.normalizeURI(uri);
  callback = callback ? callback : defaultCallback;

  // Set the forward link
  var query = {
        _id: self.generateKey(campaign, uri, owner),
        'children.uris': {
          $nin: [ uri ]
        }
      }
    , updates = {
        $inc: { 'children.count': 1 },
        $set: { 'children.modified': Date.now() },
        $addToSet: { 'children.uris': uri }
      }
    ;
  
  self.infringements_.update(query, updates, defaultCallback);

  // Set the reverse link
  var parent = 'meta+' + owner + ':' + self.generateKey(campaign, uri, owner);
  query = {
    _id: self.generateKey(campaign, uri),
    'parents.uris': {
      $nin: [ parent ]
    }
  };
  updates = {
    $inc: { 'parents.count': 1 },
    $set: { 'parents.modified': Date.now() },
    $addToSet: { 'parents.uris': parent }
  };
  
  self.infringements_.update(query, updates, callback);
}

/**
 * Adds points to the target infringement.
 *
 * @param {object}            infringement    The infringement the points belong to.
 * @param {string}            source          The source of the points -> role.plugin
 * @param {integer}           score           The new values to be added to the points {} on the infringements.
 * @param {string}            message         Info about the context.
**/
Infringements.prototype.addPoints = function(infringement, source, score, message, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addPoints, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $inc: {
      'points.total': score
    },
    $set: {
      'points.modified': Date.now()
    },
    $push: {
      'points.entries': {
        score: score,
        source: source,
        message: message,
        created: Date.now()
      }
    },
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}

/**
 * Adds points to the target infringement and sets that infringement as processed by the processer.
 *
 * @param {object}            infringement    The infringement the points belong to.
 * @param {string}            source          The source of the points -> role.plugin
 * @param {integer}           score           The new values to be added to the points {} on the infringements.
 * @param {string}            message         Info about the context.
 * @param {integer}           processor       The processor of the infringement.
 * @param {function(err)}     callback        A callback to receive an error, if one occurs.
 * @return {undefined}
**/
Infringements.prototype.addPointsBy = function(infringement, source, score, message, processor, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addPoints, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $inc: {
      'points.total': score
    },
    $set: {
      'points.modified': Date.now()
    },
    $push: {
      'points.entries': {
        score: score,
        source: source,
        message: message,
        created: Date.now()
      },
      'metadata.processedBy': processor
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}


/**
 * Change the state field on the given infringement with the given state
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          state            The state to be to set on the infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.setState = function(infringement, state, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.setState, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.infringements_.update({ _id: infringement._id }, { $set: { state: state } }, callback);
}

/**
 * Change the state field on the given infringement with the given state and mark the
 * the infringement as processed by who.
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          state            The state to be to set on the infringement.
 * @param {integer}          processor        The processor of the infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.setStateBy = function(infringement, state, processor, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.setState, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $set: {
      state: state
    },
    $push: {
      'metadata.processedBy': processor
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}

/**
 * Gets the list of unverified infringements for a given campaign
 *
 * @param {object}           campaign         The campaign which we want unverified links for
 * @param {number}           limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err)}    callback         A callback to handle errors.
*/
Infringements.prototype.getNeedsScraping = function(campaign, limit, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getNeedsScraping, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.NEEDS_SCRAPE
  };

  self.infringements_.find(query).limit(limit ? limit : 1000).toArray(callback); 
}

/**
 * Gets the number of links that need scraping
 *
 * @param  {object}                campaign      The campaign for which to search links.
 * @param  {function(err,count)}   callback      A callback to receive the count, or an error.
 * @return {undefined}
 */
Infringements.prototype.getNeedsScrapingCount = function(campaign, callback) {
  var self = this;
  
  if (!self.infringements_)
    return self.cachedCalls_.push([self.getNeedsScrapingCount, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.NEEDS_SCRAPE
  };

  self.infringements_.find(query).count(callback); 
}

/**
 * Get infringements for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {number}                skip             The number of documents to skip, for pagenation.
 * @param {number}                limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Infringements.prototype.getForCampaign = function(campaign, skip, limit, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign
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
  * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Infringements.prototype.getCountForCampaign = function(campaign, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getCountForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign
  };

  self.infringements_.find(query).count(callback);
}

/**
 * Mark this infringement as processedBy the processor
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          processor        Who has processed this infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.processedBy = function(infringement, processor, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.processedBy, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $push: {
      'metadata.processedBy': processor
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}