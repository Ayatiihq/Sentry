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
  this.socketFile_ = "";
  this.procinfo_ = null;
  this.server_ = null;

  this.currentRoleName_ = "idle";
  this.role_ = null;
  this.oldRole_ = null;

  this.init();
}

util.inherits(Worker, events.EventEmitter);

Worker.prototype.init = function() {
  var self = this;

  self.socketFile_ = os.tmpDir() + '/worker-' + cluster.worker.id + '.sock';
  self.procinfo_ = new ProcInfo();
  
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

  if (message.type === "roleChange") {
    self.switchRoles(message.newRole);
    logger.info('Role change: ' + self.currentRoleName_);
  
  } else if (message.type == 'end') {
    logger.info('Exiting as requested');
    cluster.worker.destroy();

  } else {
    logger.warn('Unknown message: ' + util.inspect(message));
  }
}

Worker.prototype.switchRoles = function(rolename) {
  var self = this;

  if (self.oldRole_ !== null) {
    // Notify and put the old role on the back-burner
    self.oldRole_ = self.role_;
    self.oldRole_.end();
    // FIXME: Add a kill timer here
  }

  self.procinfo_.setRole(rolename);
  self.currentRoleName_ = rolename;
  var Role = require('./roles/' + rolename).Role;
  self.role_ = new Role();
}
