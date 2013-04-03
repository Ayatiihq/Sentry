/*
 * clients.js: the client table
 *
 * Wraps the client table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('clients.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var COLLECTION = 'clients';

/**
 * Wraps the clients table.
 * 
 * @return {object}
 */
var Clients = module.exports = function() {
  this.db_ = null;
  this.clients_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Clients.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.clients_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
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
 * Get a list of clients.
 *
 * @param {function(err, roles)} callback The callback to consume the clients.
 * @return {undefined}
 */
Clients.prototype.listClients = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.clients_)
    return self.cachedCalls_.push([self.listClients, Object.values(arguments)]);

  self.clients_.find().toArray(callback);
}

/**
 * Adds a client.
 *
 * @param {object}          client     An object containing details of the client.
 * @param {function(err, doc)}   callback   A callback to receive an error, if one occurs, otherwise the inserted documents.
 * @return {undefined}
 */
Clients.prototype.add = function(client, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(client && client.name)) {
    callback = callback ? callback : defaultCallback;
    return callback(new Error('Client should have name and state:' + JSON.stringify(client)));
  }

  if (!self.clients_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  client._id = client.name;
  client.created = Date.now();

  self.clients_.insert(client, callback);
}

/**
 * Update a client's details.
 *
 * @param {object}          query      The query selecting the client.
 * @param {object}          updates    An object containing updates for the client.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Clients.prototype.update = function(query, updates, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.clients_)
    return self.cachedCalls_.push([self.update, Object.values(arguments)]);

  self.clients_.update(query, { $set: updates }, callback);
}

/**
 * Remove a client.
 *
 * @param {object}          query      The query selecting the client(s).
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Clients.prototype.remove = function(query, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.clients_)
    return self.cachedCalls_.remove([self.update, Object.values(arguments)]);

  self.clients_.remove(query, callback);
}