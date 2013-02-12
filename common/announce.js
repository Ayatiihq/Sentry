/*
 * announce.js: announce Sentry and worker status to rest of the system.
 *
 * Stores announce information by date in tables, also uses service bus to 
 * broadcast state.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , cluster = require('cluster')
  , logger = acquire('logger').forFile('announce.js')
  , os = require('os')
  , sugar = require('sugar')
  , util = require('util')
  ;

var TABLE = "sentries"
  , EXPIRE_TIME_SECONDS = config.ANNOUNCE_EXPIRE_TIME_SECONDS
  , INTERVAL_TIME_SECONDS = EXPIRE_TIME_SECONDS/2
  ;

/**
 * Handles announcing of process statistics to the wider system.
 * 
 * @param {function()} metadataCallback Caller function to add additional metadata to the announce, should return a hash of key:{string}/{integer}/{date} values only.
 * @return {object}
 */
var Announce = module.exports = function(metadataCallback) {
  this.tableService_ = null;
  this.metadataCallback_ = metadataCallback;

  this.init();
}

Announce.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      console.warn(err);
    else {
      // This is our TTL
      setInterval(self.announce.bind(self), INTERVAL_TIME_SECONDS * 1000);

      // Start us off
      self.announce();
    }
  });
}

Announce.prototype.getUniqueRowKey = function() {
  var datestamp = Date.utc.create().format('{HH}{mm}');
  if(cluster.isMaster)
    return util.format('%s::%s', datestamp, os.hostname())
  else
    return util.format('%s::%s::%s', datestamp, os.hostname(), cluster.worker.id);
}

Announce.prototype.getUID = function() {
  return util.format('%s::%s', os.hostname(), process.pid);
}

Announce.prototype.getMasterData = function() {
  var data = {};

  data.hostname = os.hostname();
  data.type = os.type();
  data.platform = os.platform();
  data.arch = os.arch();
  data.release = os.release();
  data.cpus = JSON.stringify(os.cpus());
  data.uptime = os.uptime();
  data.totalmem = os.totalmem();
  data.freemem = os.freemem();
  data.pid = process.pid;
  data.memoryUsage = JSON.stringify(process.memoryUsage());
  data.processUptime = process.uptime();

  return data;
}

Announce.prototype.getWorkerData = function() {
  var data = {};

  data.workerId = cluster.worker.id;
  data.pid = process.pid;
  data.memoryUsage = JSON.stringify(process.memoryUsage());
  data.processUptime = process.uptime();

  return data;
}

//
// Public Methods
//
/**
 * Announces the process stats to the rest of the system immediately.
 *
 * @return {undefined}
 */
Announce.prototype.announce = function() {
  var self = this
    , data = cluster.isMaster ? self.getMasterData() : self.getWorkerData()
    ;

  data.PartitionKey = new Date().utc(true).beginningOfDay().getTime().toString();
  data.RowKey = self.getUniqueRowKey();
  data.uid = self.getUID();
  data.metadata = JSON.stringify(self.metadataCallback_ ? self.metadataCallback_() : {});
  self.tableService_.insertOrReplaceEntity(TABLE, data, function(err) {
    if (err)
      logger.warn('Unable to announce ' + err);
  });
}