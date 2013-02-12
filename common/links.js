/*
 * links.js: the links table
 *
 * Wraps the links table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('links.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  , utilities = require('./utilities')
  ;

var TABLE = 'links'
  , PACK_LIST = ['metadata']
  , SCHEMAS = {
    "tv.live": ['uri', 'parent', 'source', 'channel', 'genre', 'metadata']
    }
  ;

/**
 * Wraps the links table.
 * 
 * @return {object}
 */
var Links = module.exports = function() {
  this.tableService_ = null;

  this.init();
}

Links.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_CORE_ACCOUNT,
                                                config.AZURE_CORE_KEY);

  self.tableService_.createTableIfNotExists(TABLE, function(err) {
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


Links.prototype.getKeyFromCache = function(partition, key) {
  // FIXME
  return undefined;
}

Links.prototype.updateCache = function(partition, key) {
  // FIXME
}

Links.prototype.pack = function(entity) {
  PACK_LIST.forEach(function(key) {
    if (entity[key])
      entity[key] = JSON.stringify(entity[key]);
  });

  return entity;
}

Links.prototype.unpack = function(callback, err, entities) {
  var self = this;

  if (err) {
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

Links.prototype.add = function(entity, callback) {
  var self = this;

  self.tableService_.insertEntity(TABLE, entity, function(err) {
    if (!err)
      self.updateCache(entity.PartitionKey, entity.RowKey);

    if (err && err.code === 'EntityAlreadyExists')
      callback(null, entity.RowKey);
    else
      callback(err, err ? undefined : entity.RowKey);
  });
}

Links.prototype.isValid = function(link, schema, callback) {
  schema.forEach(function(key) {
    if (link[key] === undefined) {
      callback(new Error('Link object must contain ' + key));
      return false;
    }
  });
  return true;
}

Links.prototype.get = function(partition, from, callback) {
  var self = this;
  
  var query = azure.TableQuery.select()
                              .from(TABLE)
                              .where('PartitionKey eq ?', partition)
                              .and('created gt ?', from);

  self.tableService_.queryEntities(query, self.unpack.bind(self, callback));
}

//
// Public Methods
//
/**
 * Add a live tv link.
 *
 * @param  {object}            link        The found link.
 * @param  {function(err,uid)} callback    A callback to receive the uid of the uri, or an error.
 * @return {undefined}
 */
Links.prototype.addLive = function(link, callback) {
  var self = this
    , type = 'tv.live'
    ;

  callback = callback ? callback : defaultCallback;

  if (!self.isValid(link, SCHEMAS[type], callback))
    return;

  link.uri = utilities.normalizeURI(link.uri);
  link.parent = utilities.normalizeURI(link.parent);

  link.PartitionKey = type;
  link.RowKey = utilities.genLinkKey(JSON.stringify(link));

  var id = self.getKeyFromCache(link.PartitionKey, link.RowKey);
  if (id) {
    callback(null, id);
    return;
  }

  link.created = Date.utc.create().getTime();
  link = self.pack(link);

  self.add(link, callback);
}


/**
 * Get new live tv links from #date.
 *
 * @param {date}                  from        When to retrieve new links from.
 * @param {function(err,links)}   callback    Callback to receive links, or error.
 * @return {undefined}
 */
Links.prototype.getLive = function(from, callback) {
  var self = this;

  from = from.getTime();
  callback = callback ? callback : defaultCallback;

  self.get('tv.live', from, callback);
}