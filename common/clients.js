/*
 * clients.js: the client table
 *
 * Wraps the client table, caches the data, listens on the service bus for
 * any cache invalidations.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , crypto = require('crypto')
  , logger = acquire('logger').forFile('queue.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var TABLE = 'clients';
var PARTITION = '0';

/**
 * Wraps and caches the clients table.
 * 
 * @return {object}
 */
var Clients = module.exports = function() {
  this.tableService_ = null;

  this.cache_ = null;

  this.init();
}

Clients.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_CORE_ACCOUNT,
                                                config.AZURE_CORE_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn(err);
}

Clients.prototype.genClientKey = function(name) {
  var shasum = crypto.createHash('sha1');
  shasum.update(name + Date.utc.create().toISOString());
  return shasum.digest('hex');
}

//
// Public Methods
//
/**
 * Get a list of clients.
 *
 * @param {function(err, roles)} callback The callback to consume the clients.
 * @return {undefined}
 */
Clients.prototype.listClients = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (self.cache_) {
    callback(null, self.cache_);
    return;
  }

  var query = azure.TableQuery.select().from(TABLE);
  self.tableService_.queryEntities(query, callback);
}

/**
 * Adds a client.
 *
 * @param {object}          client     An object containing details of the client.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Clients.prototype.add = function(client, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(client && client.name && client.state)) {
    callback(new Error('Client should have name and state'));
    return;
  }

  client.PartitionKey = PARTITION;
  client.RowKey = self.genClientKey(client.name);
  client.created = new Date.utc.create();

  self.tableService_.insertEntity(TABLE, client, callback);
  self.cache_ = null;
}

/**
 * Update a client's details.
 *
 * @param {object}          updates    An object containing updates for the client.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Clients.prototype.update = function(updates, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(updates && updates.PartitionKey && updates.RowKey)) {
    callback(new Error('Updates should have PartitionKey and RowKey'));
    return;
  }
  self.tableService_.mergeEntity(TABLE, updates, callback);
  self.cache_ = null;
}

/**
 * Remove a client.
 *
 * @param {object}          client     An object containing details of the client.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Clients.prototype.remove = function(client, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(client && client.PartitionKey && client.RowKey)) {
    callback(new Error('Client should have PartitionKey and RowKey'));
    return;
  }
  self.tableService_.deleteEntity(TABLE, client, callback);
  self.cache_ = null;
}