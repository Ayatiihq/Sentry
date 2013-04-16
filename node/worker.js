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

var acquire = require('acquire')
  , cluster = require('cluster')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('worker.js')
  , net = require('net')
  , util = require('util')
  , os = require('os')
  ;

var Worker = module.exports = function() {
  this.socketFile_ = "";
  this.server_ = null;

  this.currentRoleName_ = "idle";
  this.role_ = null;

  this.init();
}

util.inherits(Worker, events.EventEmitter);

Worker.prototype.init = function() {
  var self = this;

  self.socketFile_ = os.tmpDir() + '/worker-' + cluster.worker.id + '.sock';
  
  process.on('message', self.onMessage.bind(self));
  process.on('exit', self.cleanupSocket.bind(self));
  
  self.startServer();
}

Worker.prototype.startServer = function() {
  var self = this;

  // In case bad stuff happened before
  self.cleanupSocket();

  self.server_ = net.createServer(function(c) {});
  self.server_.listen(self.socketFile_, function() {
    logger.info('Server started (' + self.socketFile_ + ')');
  });
}

Worker.prototype.cleanupSocket = function() {
  var self = this;

  try {
    fs.unlinkSync(self.socketFile_);
  } catch (err) {
    ;
  }
}

Worker.prototype.onMessage = function(message) {
  var self = this;

  if (message.type === 'doWork') {
    var work = message.work;
    self.setRole(work.rolename);

  } else if (message.type === 'end') {
    self.startExit();
  
  } else {
    logger.warn('Unknown message: ' + util.inspect(message));
  }
}

Worker.prototype.setRole = function(rolename) {
  var self = this;

  logger.info('Role change: ' + rolename);

  self.currentRoleName_ = rolename;
  logger.setRole(rolename);
  
  var Role = require('../common/roles/' + rolename);
  self.role_ = new Role();
  self.role_.on('ended', self.onRoleEnded.bind(self));
  self.role_.on('finished', self.onRoleFinished.bind(self));
  self.role_.on('error', self.onRoleError.bind(self));
  
  self.role_.start();

  setTimeout(function() {
    logger.warn('Role took too long to run, reaping.')
    process.exit(1);
  },
  1000 * 60 * 90);
}

Worker.prototype.startExit = function() {
  var self = this;

  logger.info('Exiting as requested by master');

  if (self.role_ !== null) {
    // The role will signal when it's done and we'll destroy ourselves
    self.role_.end();
  } else {
    // No current role, so just exit
    cluster.worker.destroy();
  }
}

Worker.prototype.onRoleEnded = function() {
  var self = this;

  logger.info('Role "' + self.currentRoleName_ + '" has ended, exiting');
  cluster.worker.destroy();
}

Worker.prototype.onRoleFinished = function() {
  var self = this;

  logger.info('Role "' + self.currentRoleName_ + '" has finished, exiting');
  cluster.worker.destroy();
}

Worker.prototype.onRoleError = function() {
  var self = this;

  logger.info('Role "' + self.currentRoleName_ + '" has an error, exiting');
  cluster.worker.destroy();
}
