/*
 * roles-cache.js: managing the availab
 *
 * (C) 2012 Ayatii Limited
 *
 * RolesCache tells the Master what processes to start and the roles they should 
 * perform.
 *
 */

var cluster = require('cluster')
  , config = require('../config')
  , events = require('events')
  , fs = require('fs')
  , logger = require('../logger').forFile('roles-cache.js')
  , util = require('util')
  ;

var ROLES_DIR = './roles';

var RolesCache = exports.RolesCache = function() {
  this.ready_ = false;
  this.singletonRoles_ = [];
  this.scalableRoles_ = [];

  this.init();
}

util.inherits(RolesCache, events.EventEmitter);

RolesCache.prototype.init = function() {
  var self = this;

  // Workes from toplevel
  fs.readdir(ROLES_DIR, self.onRolesDirRead.bind(self));
}

RolesCache.prototype.onRolesDirRead = function(err, files) {
  var self = this;

  files.forEach(function(file) {
    if (file.endsWith('.js'))
      return;
    self.loadRole('./' + file + '/package.json');
  });

  self.removeRoles();

  self.ready_ = true;
  self.emit('ready');
}

RolesCache.prototype.loadRole = function(roleinfopath) {
  var self = this;

  logger.info('Loading role: ' + roleinfopath);

  try {
    var info = require(roleinfopath);
    
    if (info.type === 'singleton') {
      self.singletonRoles_.push(info);
    
    } else if (info.type === 'scalable') {
      self.scalableRoles_.push(info);
    
    } else {
      console.warn('Unable to process role of type: ' + info.type);
    }
  } catch (error) {
    logger.warn('Unable to load role: ' + rolepath + ': ' + error);
  }
}

RolesCache.prototype.removeRoles = function() {
  // Remove roles that
  // - Have been exluded by envvar variables
  // - Do not apply to this platform
}

//
// Public
//
RolesCache.prototype.isReady = function() {
  return this.ready_;
}

RolesCache.prototype.getSingletonRoles = function() {
  return this.singletonRoles_;
}

RolesCache.prototype.getScalableRoles = function() {
  return this.scalableRoles_;
}