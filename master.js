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
  , events = require('events')
  , logger = require('./logger').forFile('master.js')
  , util = require('util')
  , os = require('os')
  ;

var ProcInfo = require('./procinfo').ProcInfo
  , Scheduler = require('./scheduler').Scheduler;

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
  self.scheduler_.on('createWorker', self.createWorker.bind(self));

  cluster.on('exit', self.onWorkerExit.bind(self));

  // Now we're ready to start processing workers
  self.scheduler_.start();
}

Master.prototype.createWorker = function() {
  var self = this;

  var worker = cluster.fork();
  worker.role = "idle";
  /*worker.on('message', function(message) {
    self.onWorkerMessage(worker, message);
  });*/
  worker.on('message', self.onWorkerMessage.bind(this, worker));

  logger.info('Created worker ' + worker.id);
}

Master.prototype.onWorkerExit = function(worker, code, signal) {
  logger.warn('Worker ' + worker.id + ' died: Code=' + code + ', Signal=' + signal);
}

Master.prototype.onWorkerMessage = function(worker, message) {
  var self = this;

  if (message.type === 'workerAnnounce') {
    self.procinfo_.announceWorker(message.key, message.value);
  
  } else {
    logger.warn('Unknown worker message: ' + util.inspect(message));
  }
}