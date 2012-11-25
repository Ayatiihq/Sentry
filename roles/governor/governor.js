/*
 * governor.js: the governor
 *
 * (C) 2012 Ayatii Limited
 *
 * Governor represents the cluster to the rest of the hive, starts the appropriete
 * number of workers, and uses the schedular to assign the correct roles to them.
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('governor.js')
  , util = require('util')
  ;

var Governor = exports.Role = function() {
  this.init();
}

util.inherits(Governor, events.EventEmitter);

Governor.prototype.init = function() {
  var self = this;
  logger.info('Governor up and running');
}