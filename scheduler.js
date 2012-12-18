/*
 * scheduler.js: the scheduler
 *
 * (C) 2012 Ayatii Limited
 *
 * Scheduler tells the Master what processes to start and the roles they should 
 * perform.
 *
 */

var cluster = require('cluster')
  , config = require('./config')
  , events = require('events')
  , logger = require('./logger').forFile('scheduler.js')
  , redis = require('./redis')
  , util = require('util')
  , os = require('os')
  ;

var RolesCache = require('./roles/roles-cache.js').RolesCache;

var MIN_CHECK_INTERVAL_SECONDS = 5;
var MAX_CHECK_INTERVAL_SECONDS = 10;
var SINGLETON_ACQUIRE_TIMEOUT_SECONDS = 60;

var Scheduler = exports.Scheduler = function() {
  this.redis_ = null;
  this.rolesCache_ = null;
  this.singletons_ = null;

  this.init();
}

util.inherits(Scheduler, events.EventEmitter);

Scheduler.prototype.init = function() {
  var self = this;

  self.rolesCache_ = new RolesCache();

  self.initRedis();
}

Scheduler.prototype.initRedis = function() {
  var self = this;

  // Setup Redis, as that is the store of process data between the hive
  self.redis_ = redis.createAuthedClient();
  if (self.redis_.ready)
    self.onReady();
  else
    self.redis_.once('ready', self.onReady.bind(self));
}

Scheduler.prototype.onReady = function() {
  var self = this;

  if (!self.rolesCache_.isReady()) {
    self.rolesCache_.once('ready', self.onReady.bind(self));
    return;
  }

  self.watchSingletons();
}

Scheduler.prototype.watchSingletons = function() {
  var self = this;

  // Keep it a bit haphazard for checking but no more than 5 mins
  var interval = Number.random(MIN_CHECK_INTERVAL_SECONDS, MAX_CHECK_INTERVAL_SECONDS) ;
  setInterval(self.tryOwnSingletonLocks.bind(self), interval * 1000);
}

Scheduler.prototype.tryOwnSingletonLocks = function() {
  var self = this;

  self.rolesCache_.getSingletonRoles().forEach(function (roleinfo) {
    var rolename = roleinfo.name;

    if (self.isWorkerAvailableForRoleChange() === null) {
      logger.info('No available workers');
      return;
    }
    self.tryOwnSingletonLock(rolename);
  });
}

Scheduler.prototype.isWorkerAvailableForRoleChange = function() {
  var self = this;

  for (var id in cluster.workers) {
    var worker = cluster.workers[id];

    // If the role is not a singleton, then it's available
    var index = self.rolesCache_.getSingletonRoles().findIndex(function(info) {
      return info.name === worker.role;
    });

    if (index === -1)
      return id;
  }

  return null;
}

Scheduler.prototype.tryOwnSingletonLock = function(rolename) {
  var self = this;

  logger.info('Checking ' + rolename + ' lock');

  var key = 'lock:' + rolename;
  self.redis_.setnx(key, 1, function (err, reply) {
    if (reply !== 0) {
      logger.info('Successfully acquired lock for ' + rolename);

      var wid = self.isWorkerAvailableForRoleChange();
      if (wid !== null) {
        // Set an expire in case something bad happens when changing the role
        self.redis_.expire(key, SINGLETON_ACQUIRE_TIMEOUT_SECONDS);

        self.emit('changeWorkerRole', cluster.workers[wid], rolename);
      
      } else {
        console.info('No workers available for new role, releasing lock');
        self.redis_.del(key);
      }
    }
  });
}

//
// Public
//
Scheduler.prototype.findRoleForWorker = function(worker) {
  var self = this;
  
  // Do something clever
}