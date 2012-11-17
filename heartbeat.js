/*
 * heartbeat.js: mediates heartbeats & keep-alives with the backend
 *
 * (C) 2012 Ayatii Limited
 *
 * Heartbeat is responsibile for sending keep-alives to a central server so other
 * nodes in the cluster can be aware of a state of a Sentry. 
 *
 */

 var events = require('events')
  , logger = require('winston')
  , util = require('util')
  ;

var Heartbeat = exports.Heartbeat = function() {
  this.init();
}

util.inherits(Heartbeat, events.EventEmitter);

Heartbeat.prototype.init = function() {
  var self = this;
  
}