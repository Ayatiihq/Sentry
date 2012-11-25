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
  , config = require('./config')
  , events = require('events')
  , json = require('jsonify')
  , logger = require('./logger').forFile('procinfo.js')
  , os = require('os')
  , redis = require("./redis")
  , sugar = require('sugar')
  , util = require('util')
  ;

var EXPIRE_TIME_SECONDS = config.ANNOUNCE_EXPIRE_TIME_SECONDS;
var INTERVAL_TIME_SECONDS = EXPIRE_TIME_SECONDS/2;

var ProcInfo = exports.ProcInfo = function() {
  this.key_ = "undefined";
  this.redis_ = null;

  this.init();
}

util.inherits(ProcInfo, events.EventEmitter);

ProcInfo.prototype.init = function() {
  var self = this;

  self.createKey();

  if (cluster.isMaster) {
    self.initRedis();
  } else {
    self.onReady();
  }
}

ProcInfo.prototype.initRedis = function() {
  var self = this;

  // Setup Redis, as that is the store of process data between the hive
  self.redis_ = redis.createAuthedClient();
  if (self.redis_.ready)
    self.onReady();
  else
    self.redis_.on('ready', self.onReady.bind(self));
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

ProcInfo.prototype.onReady = function() {
  var self = this;

  // This is our TTL
  setInterval(self.announce.bind(self), INTERVAL_TIME_SECONDS * 1000);

  // Start us off
  self.announce();
}

ProcInfo.prototype.announce = function() {
  var self = this;

  if (cluster.isMaster) {
    var data = self.getMasterData();

    self.announceKeyValue(self.key_, data);
  
  } else {
    var data = self.getWorkerData();

    // We send it up to the Master to deal with
    process.send({
      worker: cluster.worker.id,
      type: "workerAnnounce",
      key: self.key_,
      value: data
    });
  }
}

ProcInfo.prototype.announceWorker = function(key, value) {
  var self = this;
  self.announceKeyValue(key, value)
}

ProcInfo.prototype.announceKeyValue = function(key, value) {
  var self = this;

  // Set the key, which expires the TTL...
  self.redis_.set(key, value);
  // ...so restate the TTL
  self.redis_.expire(key, EXPIRE_TIME_SECONDS);
}

ProcInfo.prototype.getMasterData = function() {
  var data = {};

  data.timestamp = Date.now();
  data.hostname = os.hostname();
  data.type = os.type();
  data.platform = os.platform();
  data.arch = os.arch();
  data.release = os.release();
  data.cpus = os.cpus();
  data.uptime = os.uptime();
  data.totalmem = os.totalmem();
  data.freemem = os.freemem();
  data.pid = process.pid;
  data.memoryUsage = json.stringify(process.memoryUsage());
  data.processUptime = process.uptime();

  return json.stringify(data);
}

ProcInfo.prototype.getWorkerData = function() {
  var data = {};

  data.timestamp = Date.now();
  data.role = "idle";
  data.workerId = cluster.worker.id;
  data.pid = process.pid;
  data.memoryUsage = json.stringify(process.memoryUsage());
  data.processUptime = process.uptime();

  return json.stringify(data);
}