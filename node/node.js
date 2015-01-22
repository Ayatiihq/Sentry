/*
 * node.js: lol
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , logger = acquire('logger')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Master = require('./master')
  , Worker = require('./worker')
  ;

var Node = module.exports = function() {
  this.task_ = null;

  this.init();
}

Node.prototype.init = function() {
  var self = this;

  self.task_ = cluster.isMaster ? new Master() : new Worker();
}