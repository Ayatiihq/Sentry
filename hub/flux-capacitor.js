/*
 * flux-capacitor.js: figures out what the system should do next
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('flux-capacitor.js')
  , util = require('util')
  ;


var FluxCapacitor = module.exports = function(task, argv, done) {

  this.init();
}

util.inherits(FluxCapacitor, events.EventEmitter);

FluxCapacitor.prototype.init = function() {
  var self = this;
}

FluxCapacitor.prototype.getWork = function(callback) {
  var self = this;

  callback = callback ? callback : function() {};

  callback();
}