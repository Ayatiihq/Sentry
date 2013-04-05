/*
 * users.js: the user table
 *
 * Wraps the user table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , bcrypt = require('bcrypt')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('users.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var COLLECTION = 'users';

/**
 * Wraps the users table.
 * 
 * @return {object}
 */
var Users = module.exports = function() {
  this.db_ = null;
  this.users_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Users.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.users_ = collection;

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

Users.prototype.hashPassword = function(password, callback) {
  var self = this;

  bcrypt.genSalt(10, function(err, salt) {
    if (err)
      return callback(err);

    bcrypt.hash(password, salt, callback);
  });
}

//
// Public Methods
//
/**
 * Get a list of users.
 *
 * @param {function(err, roles)} callback The callback to consume the users.
 * @return {undefined}
 */
Users.prototype.list = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.users_)
    return self.cachedCalls_.push([self.list, Object.values(arguments)]);

  self.users_.find().toArray(callback);
}

/**
 * Adds a user.
 *
 * @param {object}          user     An object containing details of the user.
 * @param {function(err, doc)}   callback   A callback to receive an error, if one occurs, otherwise the inserted documents.
 * @return {undefined}
 */
Users.prototype.add = function(user, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(user && user.email && user.name && user.client && user.password)) {
    callback = callback ? callback : defaultCallback;
    return callback(new Error('Client should have name and state:' + JSON.stringify(user)));
  }

  if (!self.users_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  user._id = user.email;
  user.created = Date.now();

  self.hashPassword(user.password, function(err, hash) {
    if (err)
      return callback(err);

    user.password = hash;
    self.users_.insert(user, callback);
  });
}

/**
 * Get a user's details.
 *
 * @param {object}                  email      The email of the user.
 * @param {function(err,details)}   callback   A callback to receive the details or an error.
 * @return {undefined}
 */
Users.prototype.get = function(email, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.users_)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  self.users_.findOne({ _id: email }, callback);
}

/**
 * Update a user's details.
 *
 * @param {object}          query      The query selecting the user.
 * @param {object}          updates    An object containing updates for the user.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Users.prototype.update = function(query, updates, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.users_)
    return self.cachedCalls_.push([self.update, Object.values(arguments)]);

  self.users_.update(query, { $set: updates }, callback);
}

/**
 * Remove a user.
 *
 * @param {object}          query      The query selecting the user(s).
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Users.prototype.remove = function(query, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.users_)
    return self.cachedCalls_.remove([self.update, Object.values(arguments)]);

  self.users_.remove(query, callback);
}