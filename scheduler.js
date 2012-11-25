/*
 * scheduler.js: the scheduler
 *
 * (C) 2012 Ayatii Limited
 *
 * Scheduler tells the Master what processes to start and the roles they should 
 * perform.
 *
 */

var cluster = require('cluster')
  , events = require('events')
  , logger = require('./logger').forFile('scheduler.js')
  , redis = require('./redis')
  , util = require('util')
  , os = require('os')
  ;

var Scheduler = exports.Scheduler = function() {
  this.init();
}

util.inherits(Scheduler, events.EventEmitter);

Scheduler.prototype.init = function() {
  var self = this;
}