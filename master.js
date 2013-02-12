/*
 * master.js: the master
 *
 * (C) 2012 Ayatii Limited
 *
 * Master represents the cluster to the rest of the hive, starts the appropriete
 * number of workers, and uses the scheduler to assign the correct roles to them.
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('master.js')
  , util = require('util')
  , os = require('os')
  ;

var Announce = acquire('announce')
  , Scheduler = require('./scheduler');

var WORKER_KILL_WAIT_SECONDS = 60;

var Master = module.exports = function() {
  this.announce_ = null;
  this.scheduler_ = null;

  this.init();
}

util.inherits(Master, events.EventEmitter);

Master.prototype.init = function() {
  var self = this;

  self.announce_ = new Announce();
  
  self.scheduler_ = new Scheduler();
  self.scheduler_.on('changeWorkerRole', self.changeWorkerRole.bind(self));

  cluster.on('exit', self.onWorkerExit.bind(self));

  self.tryFillWorkerSlots();
}

Master.prototype.changeWorkerRole = function(worker, rolename, callback) {
  var self = this;

  if (callback === undefined)
    callback = function() {};

  if (worker.role !== "idle") {
    // Try ending the current worker in this slot nicely
    worker.send({ type: "end" });
    worker.killId = setTimeout(self.forceKillWorker.bind(self, worker),
                               WORKER_KILL_WAIT_SECONDS * 1000);

    // Create a new worker
    worker = self.createWorker();
  }

  self.setWorkerRole(worker, rolename, callback);
}

Master.prototype.setWorkerRole = function(worker, rolename, callback) {
  worker.role = rolename;
  worker.send({ type: "roleChange", newRole: rolename });

  callback(worker);
}

Master.prototype.forceKillWorker = function(worker) {
  worker.destroy();
}

Master.prototype.onWorkerExit = function(worker, code, signal) {
  var self = this;

  if (worker.suicide === true) {
    logger.info('Worker ' + worker.id + " died as expected.");
    if (worker.killId !== 0)
      clearTimeout(worker.killId);
  } else {
    logger.warn('Worker ' + worker.id + ' died: Code=' + code + ', Signal=' + signal);
  }

  self.tryFillWorkerSlots();
}

Master.prototype.tryFillWorkerSlots = function() {
  var self = this;
  var nPossibleWorkers = Math.min(os.cpus().length, config.MAX_WORKERS);
  var nActiveWorkers = Object.size(cluster.workers);
  var nNewWorkers = nPossibleWorkers - nActiveWorkers;

  if (nNewWorkers < 1)
    return;
 
  for (var i = 0; i < nNewWorkers; i++) {
    var worker = self.createWorker();
    self.scheduler_.findRoleForWorker(worker);
  }
}

Master.prototype.createWorker = function() {
  var self = this;

  var worker = cluster.fork();
  worker.role = "idle";
  worker.on('message', self.onWorkerMessage.bind(this, worker));
  worker.killId = 0;

  logger.info('Created worker ' + worker.id);

  return worker;
}

Master.prototype.onWorkerMessage = function(worker, message) {
  var self = this;

  logger.warn('Unknown worker message: ' + util.inspect(message));
}
