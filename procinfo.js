/*
 * procinfo.js: mediates procinfos & keep-alives with the backend
 *
 * (C) 2012 Ayatii Limited
 *
 * ProcInfo is responsibile for sending keep-alives to a central server so other
 * nodes in the cluster can be aware of a state of a Sentry. 
 *
 */

var events = require('events')
  , logger = require('./logger').forFile('procinfo.js')
  , redis = require("./redis")
  , util = require('util')
  ;

var ProcInfo = exports.ProcInfo = function() {
  this.redis_ = null;

  this.init();
}

util.inherits(ProcInfo, events.EventEmitter);

ProcInfo.prototype.init = function() {
  var self = this;

  self.redis_ = redis.createAuthedClient();
  self.redis_.on('ready', self.onReady.bind(self));
}

ProcInfo.prototype.onReady = function() {
  var self = this;

  logger.info('Ready (redis: ' + self.redis_.server_info.redis_version + ')');
}