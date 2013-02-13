/*
 * settings.js: store and retrieve arbritary settings key/values.
 *
 * Wraps the settings table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('settings.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var TABLE = 'settings';

/**
 * Create a new settings object for the domain which should be unique to the consumer and it's
 * arguments, so there are 'spider' level settings with domain '$spiderName', but there might 
 * be 'spider & campaign' level settings with domain '$spiderName.$campaignId'.
 *
 * @param {string}    domain     The domain representing the settings.
 * @return {object}
 */
var Settings = module.exports = function(domain) {
  this.tableService_ = null;
  this.partition_ = domain ? domain : 'undefined';

  this.init();
}

Settings.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}


//
// Public Methods
//
/**
 * Get all keys and values.
 *
 * @param {function(err, properties)}    callback    A callback to receive the properties.
 * @return {undefined}
 */
Settings.prototype.getAll = function(callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select()
                              .from(TABLE)
                              .where('PartitionKey eq ?', self.partition_);
  
  self.tableService_.queryEntities(query, function(err, entities) {
    if (err) {
      callback(err);
      return;
    }

    var properties = {};
    entities.forEach(function(entity) {
      properties[entity.RowKey.unescapeURL(true)] = JSON.parse(entity.value);
    });

    callback(null, properties);
  });  
}

/**
 * Get the value of a key.
 *
 * @param {string}                  key         A key. Only numbers, letters and `.` allowed.
 * @param {function(err, value)}    callback    A callback to receive the value.
 * @return {undefined}
 */
Settings.prototype.get = function(key, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;
  key = key.escapeURL(true);

  self.tableService_.queryEntity(TABLE, self.partition_, key, function(err, entity) {
    if (err && err.code == 'ResourceNotFound')
      callback();
    else if (err)
      callback(err);
    else if (entity && entity.value) {
      callback(null, JSON.parse(entity.value));
    } else {
      callback();
    }
  });
}

/**
 * Set the value of a key.
 *
 * @param {string}           key         A key. Only numbers, letters and `.` allowed.
 * @param {any}              value       The value to set.
 * @param {function(err)}    callback    A callback to receive and error.
 * @return {undefined}
 */
Settings.prototype.set = function(key, value, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;
  key = key.escapeURL(true);

  var entity = {};
  entity.PartitionKey = self.partition_;
  entity.RowKey = key;
  entity.value = JSON.stringify(value);

  self.tableService_.insertOrReplaceEntity(TABLE, entity, callback);
}

/**
 * Set all properties for the domain.
 *
 * @param {object}           properties  The properties to set.
 * @param {function(err)}    callback    A callback to receive and error.
 * @return {undefined}
 */
Settings.prototype.setAll = function(properties, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  self.tableService_.beginBatch();

  Object.keys(properties, function(key) {
    var entity = {};
    entity.PartitionKey = self.partition_;
    entity.RowKey = key.escapeURL(true);
    entity.value = JSON.stringify(properties[key]);

    self.tableService_.insertOrReplaceEntity(TABLE, entity, callback);
  });

  self.tableService_.commitBatch(callback);
}

/**
 * Delete a key.
 *
 * @param {string}            key           The key to remove.
 * @param {function(err)}     callback      A callback to handle errors.
 * @return {undefined}
 */
Settings.prototype.delete = function(key, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity.PartitionKey = self.partition_;
  entity.RowKey = key.escapeURL(true);

  self.tableService_.deleteEntity(TABLE, entity, callback);
}