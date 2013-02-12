/*
 * clients.js: the client table
 *
 * Wraps the client table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('clients.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var Swarm = acquire('swarm');

var TABLE = 'clients';
var PARTITION = '0';

/**
 * Wraps the clients table.
 * 
 * @return {object}
 */
var Clients = module.exports = function() {
  this.tableService_ = null;

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
    logger.warn('Reply Error: %s', err);
}

Clients.prototype.genClientKey = function(name) {
  return name;
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
  client.created = Date.utc.create().getTime();

  self.tableService_.insertEntity(TABLE, client, callback);
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
}