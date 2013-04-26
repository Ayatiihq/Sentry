/*
 * hosts.js: host actions
 *
 * Wraps the host actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('hosts.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq');

/**
 * Wraps the hosts table.
 * 
 * @return {object}
 */
var Hosts = module.exports = function() {
  this.db_ = null;
  this.hosts_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Hosts.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('hosts', this);
    })
    .seq(function(db, hosts) {
      self.db_ = db;
      self.hosts_ = hosts;
      this();
    })
    .seq(function() {
      self.cachedCalls_.forEach(function(call) {
        call[0].apply(self, call[1]);
      });
      self.cachedCalls_ = [];
    })
    .catch(function(err) {
      logger.warn('Unable to initialise %s', err);
    })
    ;
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

//
// Public Methods
//

/**
 * Gets a host's details
 *
 * @param {object}                   host             The key of the host
 * @param {function(err,details)}    callback         A callback to receive the details, or an error;
*/
Hosts.prototype.get = function(host, callback)
{
  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.hosts_.findOne({ _id: host }, callback);
}

/**
 * Add a host's details
 *
 * @param {object}                   host             The host object to add
 * @param {function(err,details)}    callback         A callback to receive the details, or an error;
*/
Hosts.prototype.add = function(host, callback)
{
  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  host.created = Date.now();

  self.hosts_.insert(host, callback);
}