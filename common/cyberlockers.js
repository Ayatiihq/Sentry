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
  this.knownDomains_ = null;
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

Cyberlockers.prototype.populateKnownDomains = function(callback) {
  var self = this;
  
  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.populateKnownDomains, Object.values(arguments)]);
  
  callback = callback ? callback : defaultCallback;
  
  self.cyberlockers_.find({}, { _id: 1 }).toArray(function(err, cls){
    if(err)
      return callback(err);
    callback(null, cls.map(function(cl){ return cl._id}));
  });
}

Cyberlockers.prototype.all = function(callback) {
  var self = this;
  
  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.all, Object.values(arguments)]);
  
  callback = callback ? callback : defaultCallback;
  
  self.cyberlockers_.find().toArray(callback);
}

/**
 * Get a list of known cyberlocker domains.
 *
 * @param {function(err, [cyberlockers])} callback.
 * @return {undefined}
 */
Cyberlockers.prototype.knownDomains = function(callback) {
  var self = this;
  
  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.knownDomains, Object.values(arguments)]);
  
  callback = callback ? callback : defaultCallback;

  if (!self.knownDomains_){
    self.populateKnownDomains(function(err, domains){
      self.knownDomains_ = domains;
      callback(null, self.knownDomains_);      
    });
  }
  else{
    callback(null, self.knownDomains_);      
  }
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

  if (!(cyberlockerDomain)) { 
    callback(new Error('cyberlocker domain needed ?'));
    return;
  }

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);
  
  callback = callback ? callback : defaultCallback;
  
  var entry = {};
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

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.update, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;
  
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

  if (!self.cyberlockers_)
    return self.cachedCalls_.push([self.remove, Object.values(arguments)]);
  
  callback = callback ? callback : defaultCallback;
  
  self.cyberlockers_.remove({ _id: id }, callback);
}
