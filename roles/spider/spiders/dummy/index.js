/*
 * dummy.js: a dummy spider
 *
 * (C) 2012 Ayatii Limited
 *
 * Spider.
 *
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('dummy.js')
  , util = require('util')
  ;

var Spider = acquire('spider');

var Dummy = module.exports = function() {
  this.init();
}

util.inherits(Dummy, Spider);

Dummy.prototype.init = function() {
  var self = this;
  logger.info('Spider up and running');
}

//
// Overrides
//
Dummy.prototype.getName = function() {
  return "dummy";
}

Dummy.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

Dummy.prototype.stop = function() {
  var self = this;
  self.emit('finished');
}

Dummy.prototype.isAlive = function(cb) {
  var self = this;

  logger.info('Is alive called');

  self.emitLink();

  if (!self.alive)
    self.alive = 1;
  else
    self.alive++;

  if (self.alive > 4)
    cb(new Error('exceeded'));
  else
    cb();
}

Dummy.prototype.emitLink = function() {
  var self = this
    , link = {}
    ;

  link.type = 'tv.live';
  link.uri = 'http://www.example.com/qwe123';
  link.parent = '';
  link.source = 'dummy';
  link.channel = 'neiltv';
  link.genre = 'awesome';
  link.metadata = {};

  self.emit('link', link);
}