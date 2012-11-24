/*
 * worker.js: the worker
 *
 * (C) 2012 Ayatii Limited
 *
 * Worker is responsible for fulfilling any of the #Roles that are required by
 * the system. A Worker is created once per process and will choose appropriate
 * roles depending on what it's master is signaling to it. It can change
 * roles on-the-fly, but normally waits to be signalled by the currently 
 * running role for a good time to do so. 
 *
 */

var cluster = require('cluster')
  , events = require('events')
  , fs = require('fs')
  , logger = require('./logger').forFile('worker.js')
  , net = require('net')
  , util = require('util')
  , os = require('os')
  ;

var ProcInfo = require('./procinfo').ProcInfo;

var Worker = exports.Worker = function() {
  this.socketFile_ = os.tmpDir() + '/worker-' + cluster.worker.id + '.sock';
  this.procinfo_ = null;
  this.server_ = null;

  this.init();
}

util.inherits(Worker, events.EventEmitter);

Worker.prototype.init = function() {
  var self = this;

  self.procinfo_ = new ProcInfo();

  self.startServer();
/*
  logger.info('\tHostname: ' + os.hostname());
  logger.info('\tPlatform: ' + os.platform());
  logger.info('\tArch: ' + os.arch());
  logger.info('\tRelease: ' + os.release());
  logger.info('\tUptime: ' + os.uptime());
  logger.info('\tPID: ' + process.pid);
  logger.info('\tTitle: ' + process.title);
  logger.info('\tMemory: ' + util.inspect(process.memoryUsage()));
  logger.info('');*/
}

Worker.prototype.startServer = function() {
  var self = this;
  
  self.server_ = net.createServer(function(c) {});
  self.server_.listen(self.socketFile_, function() {
    logger.info('Server started (' + self.socketFile_ + ')');
  });

  process.on('exit', function () {
    try {
      fs.unlinkSync(self.socketFile_);

    } catch (err) {
      logger.warn(err);
    }
    logger.info('Exiting worker');
  });
}
