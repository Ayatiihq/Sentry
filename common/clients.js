/*
 * clients.js: the client table
 *
 * Wraps the client table.
 *
 * (C) 2012 Ayatii Limited
 
 { "_id" : "Forwind",
   "avatar" : "",
   "name" : "Forwind",
   "state" : 0,
   "priority" : 0}
 
 */

var acquire = require('acquire')
  , bcrypt = require('bcrypt')
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
 * Get a list of all clients.
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
 * Get a client's details.
 *
 * @param {object}                  client     The id of the client.
 * @param {function(err,details)}   callback   A callback to receive the details or an error.
 * @return {undefined}
 */
Clients.prototype.get = function(client, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.clients_)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  self.clients_.findOne({ _id: client }, callback);
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
 * Adds a user.
 *
 * @param {object}               client     The client to which the user will be added to.
 * @param {object}               user       An object containing details of the user.
 * @param {function(err, doc)}   callback   A callback to receive an error, if one occurs, otherwise the inserted documents.
 * @return {undefined}
 */
Clients.prototype.addUser = function(client, user, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(user && user.email && user.name && user.password)) {
    callback = callback ? callback : defaultCallback;
    return callback(new Error('User should have name, email and password:' + JSON.stringify(user)));
  }

  if (!self.clients_)
    return self.cachedCalls_.push([self.addUser, Object.values(arguments)]);

  user._id = user.email;
  user.created = Date.now();

  self.hashPassword(user.password, function(err, hash) {
    if (err)
      return callback(err);

    user.password = hash;
    var clientId
     
    self.clients_.update({_id: Object.isString(client) ? client : client._id},
                         {$push : {"users" : user}},
                         callback);
  });
}

Clients.prototype.hashPassword = function(password, callback) {
  var self = this;

  bcrypt.genSalt(10, function(err, salt) {
    if (err)
      return callback(err);

    bcrypt.hash(password, salt, callback);
  });
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