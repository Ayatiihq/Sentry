/*
 * infringements.js: the infringements table
 *
 * Wraps the infringements table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('infringements.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  , utilities = require('./utilities')
  ;

var RELATION_TABLE = 'infringementRelations'
  , TABLE = 'infringements'
  , PACK_LIST = ['metadata']
  ;

/**
 * Wraps the infringements table.
 * 
 * @return {object}
 */
var Infringements = module.exports = function() {
  this.tableService_ = null;

  this.init();
}

Infringements.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_CORE_ACCOUNT,
                                                config.AZURE_CORE_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });

  self.tableService_.createTableIfNotExists(RELATION_TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err && err.code !== 'EntityAlreadyExists')
    logger.warn('Reply Error: %s', err);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}

Infringements.prototype.getKeyFromCache = function(campaign, uri) {
  // FIXME
  return undefined;
}

Infringements.prototype.updateCache = function(campaign, uri) {
  // FIXME
}

Infringements.prototype.getKeyFromMetaCache = function(campaign, uri) {
  // FIXME
  return undefined;
}

Infringements.prototype.updateMetaCache = function(campaign, uri) {
  // FIXME
}

Infringements.prototype.getKeyFromRelationCache = function(campaign, source, target) {
  // FIXME
  return undefined;
}

Infringements.prototype.updateRelationCache = function(campaign, source, target) {
  // FIXME
}

Infringements.prototype.pack = function(entity) {
  PACK_LIST.forEach(function(key) {
    if (entity[key])
      entity[key] = JSON.stringify(entity[key]);
  });

  return entity;
}

Infringements.prototype.unpack = function(callback, err, entities){
  var self = this;

  if(err){
    callback(err);
    return;
  }
  
  entities.forEach(function(entity) {
    PACK_LIST.forEach(function(key) {
      if (entity[key])
        entity[key] = JSON.parse(entity[key]);
    });
  });
  callback(err, entities);  
}

//
// Public Methods
//
/**
 * Add a infringement for the campaign.
 *
 * @param  {stringOrObject}    campaign    The campaign the URI belongs to.
 * @param  {string}            uri         The uri to add.
 * @param  {string}            type        The type of uri.
 * @param  {string}            source      The source of this infringement.
 * @param  {object}            points      The points (rating) of this infringment (to signify how 'hot' this infringment is)
 * @param  {object}            metadata    Any metadata belonging to this infringement.
 * @param  {function(err,uid)} callback    A callback to receive the uid of the uri, or an error.
 * @return {undefined}
 */
Infringements.prototype.add = function(campaign, uri, type, source, state, points, metadata, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , key = utilities.genURIKey(uri)
    , metadata = metadata ? metdata : {}
    ;

  callback = callback ? callback : defaultCallback;
  uri = utilities.normalizeURI(uri);

  var id = self.getKeyFromCache(campaign, key);
  if (id) {
    callback(null, id);
    return;
  }

  var entity = {};
  entity.PartitionKey = campaign;
  entity.RowKey = key;
  entity.uri = uri;
  entity.type = type;
  entity.source = source;
  entity.state = state;
  entity.created = Date.utc.create().getTime();
  entity.points = points;
  entity.metadata = metadata;

  entity = self.pack(entity);

  self.tableService_.insertEntity(TABLE, entity, function(err) {
    if (!err)
      self.updateCache(campaign, key);

    if (err && err.code === 'EntityAlreadyExists')
      callback(null, key);
    else
      callback(err, err ? undefined : key);
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
Infringements.prototype.addMeta = function(campaign, uri, source, state, metadata, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , key = utilities.genURIKey(uri, source)
    , metadata = metadata ? metdata : {}
    ;

  callback = callback ? callback : defaultCallback;
  uri = utilities.normalizeURI(uri);

  var id = self.getKeyFromMetaCache(campaign, uri, source);
  if (id) {
    callback(null, id);
    return;
  }

  var entity = {};
  entity.PartitionKey = campaign;
  entity.RowKey = key;
  entity.uri = uri;
  entity.type = 'meta';
  entity.source = source;
  entity.state = state;
  entity.created = Date.utc.create().getTime();
  entity.metadata = metadata;

  entity = self.pack(entity);

  self.tableService_.insertEntity(TABLE, entity, function(err) {
    if (!err) {
      self.updateMetaCache(campaign, key);
      self.addMetaRelation(campaign, uri, source);
    }

    if (err && err.code === 'EntityAlreadyExists')
      callback(null, key);
    else
      callback(err, err ? undefined : key);
  });
}

/**
 * Adds a parent -> child relationship between uris.
 *
 * @param {stringOrObject}    campaign    The campaign the uris belong to.
 * @param {string}            source      The parent URI.
 * @param {string}            target      The child URI.
 * @param {function(err)}     callback    A callback to handle errors.
 * @return {undefined}   
 */
Infringements.prototype.addRelation = function(campaign, source, target, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , target = utilities.genURIKey(uri)
    , source = utilities.genURIKey(uri)
    ;

  callback = callback ? callback : defaultCallback;

  var id = self.getKeyFromRelationCache(campaign, source, target);
  if (id) {
    callback(null, id);
    return;
  }

  var entity = {};
  entity.PartitionKey = campaign;
  entity.RowKey = target;
  entity.source = source;
  entity.created = Date.utc.create().getTime();

  self.tableService_.insertEntity(RELATION_TABLE, entity, function(err) {
    if (!err)
      self.updateRelationCache(campaign, source, target);

    if (err && err.code === 'EntityAlreadyExists')
      callback(null);
    else
      callback(err);
  });
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
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , target = utilities.genURIKey(uri)
    , source = utilities.genURIKey(uri, owner)
    ;

  callback = callback ? callback : defaultCallback;

  var id = self.getKeyFromRelationCache(campaign, source, target);
  if (id) {
    callback(null, id);
    return;
  }

  var entity = {};
  entity.PartitionKey = campaign;
  entity.RowKey = target;
  entity.source = source;
  entity.created = Date.utc.create().getTime();

  self.tableService_.insertEntity(RELATION_TABLE, entity, function(err) {
    if (!err)
      self.updateRelationCache(campaign, source, target);

    if (err && err.code === 'EntityAlreadyExists')
      callback(null);
    else
      callback(err);
  });
}

/**
 * Adds points to the target infringement.
 *
 * @param {object}            infringement    The infringement the points belong to.
 * @param {string}            source          The source of the points -> role.plugin
 * @param {integer}           points          The new points to be added to the points {} on the infringments.
**/
Infringements.prototype.addPoints = function(infringement, source, points)
{
  if(infringement.points.hasOwnProperty(source)){
    infringement.points[source] += points;  
  }
  else{
    infringement.points[source] = points;      
  }
}

/**
 * Update the state field on the given infringement with the give newState
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          newState         The newState to be to saved on the infringment.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.changeState = function(infringement, newState, callback){
  callback = callback ? callback : defaultCallback;
  // update the state on the object
  infringement.state = newState;  
  self.tableService_.updateEntity(TABLE, infringement,
                                  function(err){
                                    if(err){
                                      console.log('err : %s', err);
                                    }
                                    callback(err)
                                  });
}

/**
 * Gets the list of unverified infringements for a given campaign
 *
 * @param {object}           campaign         The campaign which we want unverified links for
**/
Infringements.prototype.getNeedsScraping = function(campaign, callback)
{
  var self = this;
  var needScrapingEntities = [];
  
  var query = azure.TableQuery.select()
                              .from(TABLE)
                              .where('PartitionKey eq ?', campaign.RowKey)
                              .and('state eq ?', states.infringements.state.NEEDS_SCRAPE);
                              
  function reply(err, entities, res) {
    needScrapingEntities.add(entities);
    if (err){
      logger.warn(err);
      callback(err);
    }

    if (res.hasNextPage()) {
      res.getNextPage(reply);
    } else {
      self.unpack(callback, null, needScrapingEntities);
    }
  }
  self.tableService_.queryEntities(query, reply);    
}
