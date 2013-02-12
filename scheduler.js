  /*
 * scheduler.js: the scheduler
 *
 * (C) 2012 Ayatii Limited
 *
 * Scheduler tells the Master what processes to start and the roles they should 
 * perform.
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('scheduler.js')
  , util = require('util')
  , os = require('os')
  ;

var Lock = acquire('lock')
  , Roles = acquire('roles')
  , Swarm = acquire('swarm');

var MIN_CHECK_INTERVAL_SECONDS = 30;
var MAX_CHECK_INTERVAL_SECONDS = 35;
var SINGLETON_ACQUIRE_TIMEOUT_SECONDS = 180;

var Scheduler = module.exports = function() {
  this.lock_ = null;
  this.roles_ = null;
  this.swarm_ = null;

  this.init();
}

util.inherits(Scheduler, events.EventEmitter);

Scheduler.prototype.init = function() {
  var self = this;

  self.lock_ = new Lock();
  self.roles_ = new Roles();
  self.swarm_ = new Swarm();

  self.doleWorkers_ = [];

  self.onReady();
}

Scheduler.prototype.onReady = function() {
  var self = this;

  if (!self.roles_.isReady()) {
    self.roles_.once('ready', self.onReady.bind(self));
    return;
  }
  self.watchSingletons();

  self.doleWorkers_.forEach(function(worker) {
    self.findRoleForWorker(worker);
  });
  self.doleWorkers_ = [];
}

Scheduler.prototype.watchSingletons = function() {
  var self = this;

  // Keep it a bit haphazard for checking but no more than 5 mins
  var interval = Number.random(MIN_CHECK_INTERVAL_SECONDS, MAX_CHECK_INTERVAL_SECONDS) ;
  setInterval(self.tryOwnSingletonLocks.bind(self), interval * 1000);
}

Scheduler.prototype.tryOwnSingletonLocks = function() {
  var self = this;

  self.roles_.getSingletonRoles().forEach(function (roleinfo) {
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

    // If the worker's role is not a singleton, then it's available
    var index = self.roles_.getSingletonRoles().findIndex(function(info) {
      return info.name === worker.role;
    });

    if (index === -1)
      return id;
  }

  return null;
}

Scheduler.prototype.tryOwnSingletonLock = function(rolename) {
  var self = this;

  logger.info(util.format('Checking %s lock', rolename));

  self.lock_.tryLock('scheduler', rolename, SINGLETON_ACQUIRE_TIMEOUT_SECONDS, function(token) {
    if (token) {
      logger.info('Successfully acquired lock for ' + rolename);

      var wid = self.isWorkerAvailableForRoleChange();
      if (wid != null) {
        self.emit('changeWorkerRole', cluster.workers[wid], rolename, self.onSingletonAcquired.bind(self, token));
      } else {
        logger.info('No workers available for new role, releasing lock');
        self.lock_.removeLock(token);
      }
    }
  });
}

Scheduler.prototype.onSingletonAcquired = function(token, worker) {
  var self = this;

  logger.info('Acquired Singleton: ' + worker.role + ', setting up TTL');

  var uid = setInterval(function() {
    self.lock_.extendLock(token, SINGLETON_ACQUIRE_TIMEOUT_SECONDS, function(err) {
      if (err) {
        console.warn('Unable to extend lock: ' + err);
        worker.destroy();
      }
    });
  }, (SINGLETON_ACQUIRE_TIMEOUT_SECONDS/2) * 1000);
    
  worker.on('exit', function() {
    clearInterval(uid);
    self.lock_.removeLock(token);
  });
}

//
// Public
//
Scheduler.prototype.findRoleForWorker = function(worker) {
  var self = this;

  if (!self.roles_.isReady()) {
    self.doleWorkers_.push(worker);
    return;
  }

  self.swarm_.listWorkers(function(err, workers) {
    if (err) {
      logger.warn('Unable to get accurate worker list: ' + err);
      workers = [];
    }
    var roles = self.getRolesByNumber(workers);
    if (roles.length > 0) {
      self.emit('changeWorkerRole', worker, roles[0].name);
    }
  });
}

Scheduler.prototype.getRolesByNumber = function(workers) {
  var self = this;
  
  var hash = {};
  
  // Add the roles we can handle
  self.roles_.getScalableRoles().forEach(function(info) {
    hash[info.name] = { name: info.name, count: 0 };
  });

  // Weight against our own that are running, to keep things interesting
  for (var id in cluster.workers) {
    worker = cluster.workers[id];

    if (Object.has(hash, worker.role)) {
      hash[worker.role].count = 1;
    }
  }

  // Order the roles we can do by those that are already running in the swarm
  workers.forEach(function(worker) {
    if (Object.has(hash, worker.role)) {
      hash[worker.role].count++;
    }
  });

  // Convert to array and order by running roles ASC
  var ret = [];

  Object.keys(hash, function(key, value) {
    ret.push(value);
  });

  ret = ret.min(function(n) {
    return n.count;
  }, true);

  return Object.isArray(ret) ? ret.randomize() : ret;
}