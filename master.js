/*
 * master.js: the master
 *
 * (C) 2012 Ayatii Limited
 *
 * Master is responsible for fulfilling any of the #Roles that are required by
 * the system. A Master is created once per process and will choose appropriate
 * roles depending on what it's master is signaling to it. It can change
 * roles on-the-fly, but normally waits to be signalled by the currently 
 * running role for a good time to do so. 
 *
 */

var cluster = require('cluster')
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
  var n_workers = os.cpus().length;

  logger.info('Forking ' + n_workers + ' workers')
  
  for (var i = 0; i < n_workers; i++) {
    cluster.fork();
  }
  cluster.on('exit', self.onWorkerExit.bind(self));
}

Master.prototype.onWorkerExit = function(worker, code, signal) {
  logger.warn('Worker ' + worker.id + ' died: Code=' + code + ', Signal:' + signal);
}
