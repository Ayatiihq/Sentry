/*
 * runtask.js: the task runner
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , io = require('socket.io-client')
  , logger = acquire('logger').forFile('runtask.js')
  , util = require('util')
  ;


var RunTask = module.exports = function(task, argv, done) {
  this.task_ = task;
  this.argv_ = argv;
  this.done_ = done;

  this.init();
}

util.inherits(RunTask, events.EventEmitter);

RunTask.prototype.init = function() {
  var self = this
    , klass = null
    ;

  try {
    klass = require(util.format('./%s/%s', self.task_, self.task_));
  } catch (err) {
    self.done_(err);
  }

  self.runningObj = new klass();
}