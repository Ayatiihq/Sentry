/*
 * hubtask.js: the hub task runner
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , io = require('socket.io-client')
  , logger = acquire('logger').forFile('hubtask.js')
  , util = require('util')
  ;


var HubTask = module.exports = function(task, argv, done) {
  this.task_ = task;
  this.argv_ = argv;
  this.done_ = done;

  this.hub_ = null;
  this.tasksMap_ = {};

  this.init();
}

util.inherits(HubTask, events.EventEmitter);

HubTask.prototype.init = function() {
  var self = this;

  self.loadTasks();

  self.hub_ = io.connect(config.HUB_ADDRESS, { port: config.HUB_PORT, secure: true });
  self.hub_.on('connect', self.onConnection.bind(self));
  self.hub_.on('error', self.done_);
}

HubTask.prototype.loadTasks = function() {
  var self = this;

  self.tasksMap_ = {
    ping: self.ping
  };
}

HubTask.prototype.onConnection = function() {
  var self = this;

  var taskFunction = self.tasksMap_[self.task_];
  if (taskFunction) {
    taskFunction.call(self, self.argv_);
  } else {
    self.done_(util.format('Hub task %s does not exist', self.task_));
  }
}

HubTask.prototype.ping = function(argv) {
  var self = this;
}