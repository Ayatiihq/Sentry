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

var Scheduler = exports.Scheduler = function() {
  this.redis_ = null;
  this.singletons_ = null;

  this.init();
}

util.inherits(Scheduler, events.EventEmitter);

Scheduler.prototype.init = function() {
  var self = this;

  self.initRedis();
}

Scheduler.prototype.initRedis = function() {
  var self = this;

  // Setup Redis, as that is the store of process data between the hive
  self.redis_ = redis.createAuthedClient();
  if (self.redis_.ready)
    self.onReady();
  else
    self.redis_.on('ready', self.onReady.bind(self));
}

Scheduler.prototype.onReady = function() {
  var self = this;

  self.watchSingletons();
}

Scheduler.prototype.watchSingletons = function() {
  var self = this;

  // Get list of singletons we're meant to watch
  self.singletons_ = config.SINGLETON_ROLES;
  self.singletons_ = self.singletons_.subtract(config.EXCLUDE_ROLES);

  if (self.singletons_.length === 0) {
    logger.info('No singletons to process');
    return;
  }

  // Keep it a bit haphazard for checking but no more than 5 mins
  setInterval(self.tryOwnSingletonLocks.bind(self),
              Number.random(120, 300) * 1000);
}

Scheduler.prototype.tryOwnSingletonLocks = function() {
  logger.info('Checking Singleton locks');
  /*
  for singleton in Singletons && workersAvailable():
    lockowned = tryOwnLock(singleton);
    if lockowned:
      if workersAvailable():
        setExpiresTime(singleton);
        worker = chooseLeastBusyWorker();
        emit("changeWorkerRole", worker, singleton);
      else
        unlock(singleton);
      end
    end
  end
  */
}

Scheduler.prototype.createWorkers = function() {
  var self = this;
  var nWorkers = Math.min(os.cpus().length, config.MAX_WORKERS);
 
  for (var i = 0; i < nWorkers; i++) {
    self.emit('createWorker');
  }
}

//
// Public
//
Scheduler.prototype.start = function() {
  var self = this;
  
  self.createWorkers();
}