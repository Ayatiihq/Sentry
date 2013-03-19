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
  , states = acquire('states')
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

  self.hub_ = io.connect(config.HUB_ADDRESS + '/client', { port: config.HUB_PORT, secure: true });
  self.hub_.on('connect', self.onConnection.bind(self));
  self.hub_.on('error', self.done_);
}

HubTask.prototype.loadTasks = function() {
  var self = this;

  self.tasksMap_ = {
    info: self.getInfo,
    nodeinfo: self.getNodeInfo,
    state: self.getState,
    version: self.getVersion,
    ping: self.ping,
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

  self.hub_.emit('ping', argv[0], function(reply) {
    console.log(JSON.stringify(reply));
    self.done_();
  });
}

HubTask.prototype.getInfo = function(argv) {
  var self = this;

  self.hub_.emit('getInfo', '', function(reply) {
    console.log(JSON.stringify(reply));
    self.done_();
  })
}

HubTask.prototype.getNodeInfo = function(argv) {
  var self = this;

  self.hub_.emit('getNodeInfo', '', function(reply) {
    console.log(JSON.stringify(reply));
    self.done_();
  })
}

HubTask.prototype.getState = function(argv) {
  var self = this;

  if (argv && argv.length)
    return self.setState(argv);

  self.hub_.emit('getState', '', function(reply) {
    console.log(JSON.stringify(reply));
    self.done_();
  })
}

HubTask.prototype.getVersion = function(argv) {
  var self = this;

  self.hub_.emit('getVersion', '', function(reply) {
    console.log(JSON.stringify(reply));
    self.done_();
  })
}

HubTask.prototype.setState = function(argv) {
  var self = this
    , hubStates = states.hub.state
    , newState = argv[0]
    , err = null
    ;

  if (newState >= 0 && newState < Object.size(hubStates)) {
    self.hub_.emit('setState', { state: newState }, function() {
      console.log('State successfully set');
      self.done_();
    });
  } else {
    self.done_('Hub state is not in range');
  }
}