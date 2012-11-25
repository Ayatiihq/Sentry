/*
 * master.js: the master
 *
 * (C) 2012 Ayatii Limited
 *
 * Master represents the cluster to the rest of the hive, starts the appropriete
 * number of workers, and uses the schedular to assign the correct roles to them.
 *
 */

var cluster = require('cluster')
  , config = require('./config')
  , events = require('events')
  , logger = require('./logger').forFile('master.js')
  , util = require('util')
  , os = require('os')
  ;

var ProcInfo = require('./procinfo').ProcInfo;

var Master = exports.Master = function() {
  this.procinfo_ = null;

  this.init();
}

util.inherits(Master, events.EventEmitter);

Master.prototype.init = function() {
  var self = this;

  self.procinfo_ = new ProcInfo();

  self.createWorkers();

  logger.info('Master up and running');
}

Master.prototype.createWorkers = function() {
  var self = this;
  var nWorkers = Math.min(os.cpus().length, config.MAX_WORKERS);

  logger.info('Forking ' + nWorkers + ' workers')
  
  for (var i = 0; i < nWorkers; i++) {
    var worker = cluster.fork();

    worker.on('message', function(message) {
      self.onWorkerMessage(worker, message);
    });
  }
  cluster.on('exit', self.onWorkerExit.bind(self));
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