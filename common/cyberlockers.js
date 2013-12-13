/*
 * cyberlockers.js: the cyberlockers table
 *
 * Wraps the cyberlockers table.
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('cyberlockers.js')
  , sugar = require('sugar')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var COLLECTION = 'cyberlockers';

/**
 * Wraps the cyberlockers table.
 * 
 * @return {object}
 */
var Cyberlockers = module.exports = function() {
  this.db_ = null;
  this.cyberlockers_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Cyberlockers.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.cyberlockers_ = collection;

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

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}


Cyberlockers.prototype.find = function(callback) {
}

/**
 * Get a list of known cyberlocker domains.
 *
 * @param {function(err, [cyberlockers])} callback.
 * @return {undefined}
 */
Cyberlockers.prototype.knownDomains = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;
  
  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.knownDomains, Object.values(arguments)]);

  self.cyberlockers_.find().toArray(function(err, cls){
    if(err)
      return callback(err);
    var flattened = cls.map(function(cl){ return cl._id});
    callback(null, flattened);
  });
}

/**
 * Get a cyberlocker's details.
 *
 * @param {stringOrObject}             id             The cyberlocker id;
 * @param {function(err, cyberlocker)}    callback    The cyberlocker details, or error.
 * @return {undefined}
 */
Cyberlockers.prototype.getDetails = function(id, callback) {
  var self = this;

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.getDetails, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.cyberlockers_.findOne({ _id: id }, callback);
}

/**
 * Adds a cyberlocker.
 *
 * @param {string} the domain of the cyberlocker.
 * @param {function(err,cyberlocker)} callback A callback to receive an error, if one occurs, otherwise the new cyberlocker.
 * @return {undefined}
 */
Cyberlockers.prototype.add = function(cyberlockerDomain, callback) {
  var self = this
    , now = Date.now()
    ;
  
  callback = callback ? callback : defaultCallback;

  if (!(cyberlockerDomain)) { 
    callback(new Error('cyberlocker domain needed ?'));
    return;
  }

  var entry = {};

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  entry._id = cyberlockerDomain;

  entry.automated = false;
  entry.loginDetails = {};
  entry.created = now;
  entry.uriMatcher = null;
  self.cyberlockers_.insert(entry, callback);
}

/**
 * Update a cyberlocker's details.
 *
 * @param {object}          id      The id for the cyberlocker.
 * @param {object}          updates    An object containing updates for the cyberlocker.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Cyberlockers.prototype.update = function(id, updates, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.update, Object.values(arguments)]);

  self.cyberlockers_.update({ _id: id }, { $set: updates }, callback);
}

/**
 * Remove a cyberlocker.
 *
 * @param {object}          id      The domain of the target cyberlocker.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Cyberlockers.prototype.remove = function(id, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.remove, Object.values(arguments)]);

  self.cyberlockers_.remove({ _id: id }, callback);
}
