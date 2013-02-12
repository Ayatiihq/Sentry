/*
 * swarm.js: monitor about the sentry swarm.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , cluster = require('cluster')
  , logger = acquire('logger').forFile('swarm.js')
  , os = require('os')
  , sugar = require('sugar')
  , util = require('util')
  ;

var TABLE = "sentries"
  , EXPIRE_TIME_SECONDS = config.ANNOUNCE_EXPIRE_TIME_SECONDS
  ;

/**
 * Handles announcing of process statistics to the wider system.
 * 
 * @param {function()} metadataCallback Caller function to add additional metadata to the announce, should return a hash of key:{string}/{integer}/{date} values only.
 * @return {object}
 */
var Swarm = module.exports = function(metadataCallback) {
  this.tableService_ = null;

  this.init();
}

Swarm.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

//
// Public Methods
//

/**
 * Get a list of currently active masters.
 *
 * @param {function(err, roles)} callback The callback to consume the masters, err is valid if there was an error.
 * @return {undefined}
 */
Swarm.prototype.listMasters = function(callback) {
  var self = this
    , then = Date.utc.create(EXPIRE_TIME_SECONDS + ' seconds ago').toISOString()
    ;
 
  var query = azure.TableQuery.select('uid', 'metadata', 'Timestamp')
                              .from(TABLE)
                              .where('Timestamp > datetime?', then);

  self.tableService_.queryEntities(query, function(err, entities) {
    var ret = [];

    if (!err) {
      var roles = {};

      // Make sure we only count each worker once
      entities.forEach(function(e) {
        var metadata = JSON.parse(e.metadata);
        if (!metadata.role) {
          roles[e.uid] = metadata.role;
        }
      });

      // Form the reply
      Object.keys(roles, function(k, v) {
        ret.push({ uid: k });
      });
    }
    callback(err, ret);
  });
}

/**
 * Get a list of currently active workers.
 *
 * @param {function(err, roles)} callback The callback to consume the workers, err is valid if there was an error.
 * @return {array}
 */
Swarm.prototype.listWorkers = function(callback) {
  var self = this
    , then = Date.utc.create(EXPIRE_TIME_SECONDS + ' seconds ago').toISOString()
    ;
 
  var query = azure.TableQuery.select('uid', 'metadata', 'Timestamp').from(TABLE).where('Timestamp > datetime?', then);

  self.tableService_.queryEntities(query, function(err, entities) {
    var ret = [];

    if (!err) {
      var roles = {};

      // Make sure we only count each worker once
      entities.forEach(function(e) {
        var metadata = JSON.parse(e.metadata);
        if (metadata.role) {
          roles[e.uid] = metadata.role;
        }
      });

      // Form the reply
      Object.keys(roles, function(k, v) {
        ret.push({ uid: k, role: v });
      });
    }
    callback(err, ret);
  });
}

/**
 * Returns an unique id for this process.
 *
 * @return {string} an unique id for this instance.
 */
Swarm.getUID = function() {
  return util.format('%s-%s', os.hostname(), process.pid);
}