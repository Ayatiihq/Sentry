/*
 * procinfo.js: mediates procinfos & keep-alives with the backend
 *
 * (C) 2012 Ayatii Limited
 *
 * ProcInfo is responsibile for sending keep-alives to a central server so other
 * nodes in the cluster can be aware of a state of a Sentry. 
 *
 */

var cluster = require('cluster')
  , events = require('events')
  , logger = require('./logger').forFile('procinfo.js')
  , os = require('os')
  , redis = require("./redis")
  , util = require('util')
  ;

var ProcInfo = exports.ProcInfo = function() {
  this.key_ = "undefined";
  this.redis_ = null;

  this.init();
}

util.inherits(ProcInfo, events.EventEmitter);

ProcInfo.prototype.init = function() {
  var self = this;

  self.createKey();

  // Setup Redis, as that is the store of process data between the hive
  self.redis_ = redis.createAuthedClient();
  if (self.redis_.ready)
    self.onRedisReady();
  else
    self.redis_.on('ready', self.onRedisReady.bind(self));
}

ProcInfo.prototype.createKey = function() {
  var self = this;
  var hostname = os.hostname();

  if (cluster.isMaster) {
    self.key_ = 'master:' + hostname;
  } else {
    self.key_ = 'worker:' + hostname + ':' + cluster.worker.id;
  }

  logger.info('Process key: ' + self.key_);
}

ProcInfo.prototype.onRedisReady = function() {
  var self = this;
}