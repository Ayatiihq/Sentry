/*
 * master.js: the master
 *
 * (C) 2012 Ayatii Limited
 *
 * Master represents the cluster to the rest of the hive, starts the appropriete
 * number of workers, and uses the scheduler to assign the correct roles to them.
 *
 */

var cluster = require('cluster')
  , config = require('./config')
  , events = require('events')
  , logger = require('./logger').forFile('master.js')
  , util = require('util')
  , os = require('os')
  ;

var ProcInfo = require('./procinfo').ProcInfo
  , Scheduler = require('./scheduler').Scheduler;

var WORKER_KILL_WAIT_SECONDS = 60;

var Master = exports.Master = function() {
  this.procinfo_ = null;
  this.scheduler_ = null;

  this.init();
}

util.inherits(Master, events.EventEmitter);

Master.prototype.init = function() {
  var self = this;

  self.procinfo_ = new ProcInfo();
  
  self.scheduler_ = new Scheduler();
  self.scheduler_.on('changeWorkerRole', self.changeWorkerRole.bind(self));

  cluster.on('exit', self.onWorkerExit.bind(self));

  self.tryFillWorkerSlots();
}

Master.prototype.changeWorkerRole = function(worker, rolename) {
  var self = this;

  if (worker.role === "idle") {
    worker.role = rolename;
    worker.send({ type: "roleChange", newRole: rolename });
    return;
  }

  // Try ending the current worker in this slot nicely
  worker.send({ type: "end" });
  worker.killId = setTimeout(self.forceKillWorker.bind(self, worker),
                             WORKER_KILL_WAIT_SECONDS * 1000);

  // Create a new worker and set it's role
  newWorker = self.createWorker();
  newWorker.role = rolename;
  newWorker.send({ type: "roleChange", newRole: rolename });
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

  if (message.type === 'workerAnnounce') {
    self.procinfo_.announceWorker(message.key, message.value);
  
  } else {
    logger.warn('Unknown worker message: ' + util.inspect(message));
  }
}
