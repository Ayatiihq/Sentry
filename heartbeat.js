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
  , logger = require('./logger').forFile('heartbeat.js')
  , redis = require("./redis")
  , util = require('util')
  ;

var Heartbeat = exports.Heartbeat = function() {
  this.client_ = null;

  this.init();
}

util.inherits(Heartbeat, events.EventEmitter);

Heartbeat.prototype.init = function() {
  var self = this;

  self.client_ = redis.createAuthedClient();
  self.client_.on('ready', self.onReady.bind(self));
}

Heartbeat.prototype.onReady = function() {
  var self = this;

  logger.info('Ready (redis: ' + self.client_.server_info.redis_version + ')');
}