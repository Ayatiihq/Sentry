/*
 * settings.js: store and retrieve arbritary settings key/values.
 *
 * Wraps the settings table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('settings.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var COLLECTION = 'settings';

/**
 * Create a new settings object for the domain which should be unique to the consumer and it's
 * arguments, so there are 'spider' level settings with domain '$spiderName', but there might 
 * be 'spider & campaign' level settings with domain '$spiderName.$campaignId'.
 *
 * @param {string}    domain     The domain representing the settings.
 * @return {object}
 */
var Settings = module.exports = function(domain) {
  this.settings_ = null;
  this.domain_ = domain ? domain : 'undefined';

  this.cachedCalls_ = [];

  this.init();
}

Settings.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.settings_ = collection;

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
 * Get all keys and values.
 *
 * @param {function(err, properties)}    callback    A callback to receive the properties.
 * @return {undefined}
 */
Settings.prototype.getAll = function(callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.settings_)
    return self.cachedCalls_.push([self.getAll, Object.values(arguments)]);

  self.settings_.find({ '_id.domain': self.domain_ }).toArray(callback);
}

/**
 * Get the value of a key.
 *
 * @param {string}                  key         A key. Only numbers & letters allowed.
 * @param {function(err, value)}    callback    A callback to receive the value.
 * @return {undefined}
 */
Settings.prototype.get = function(key, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.settings_)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  self.settings_.findOne({ _id: { domain: self.domain_, key: key } }, function(err, doc) {
    if (doc && doc.value != undefined)
      callback(null, doc.value);
    else
      callback(err);
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

 if (!self.settings_)
    return self.cachedCalls_.push([self.set, Object.values(arguments)]);

  var doc = {
    _id: {
      domain: self.domain_,
      key: key
    },
    value: value
  };

  self.settings_.save(doc, callback);
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

 if (!self.settings_)
    return self.cachedCalls_.push([self.delete, Object.values(arguments)]);

  self.settings_.remove({ _id: { domain: self.domain_, key: key } }, callback);
}