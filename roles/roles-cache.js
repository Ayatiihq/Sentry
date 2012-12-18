/*
 * roles-cache.js: managing the availab
 *
 * (C) 2012 Ayatii Limited
 *
 * RolesCache compiles a cache of all the available roles so the scheduler can
 * easily enumerate them.
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

RolesCache.prototype.loadRole = function(infopath) {
  var self = this;

  logger.info('Loading role: ' + infopath);

  try {
    var info = require(infopath);
    
    if (info.type === 'singleton') {
      self.singletonRoles_.push(info);
    
    } else if (info.type === 'scalable') {
      self.scalableRoles_.push(info);
    
    } else {
      console.warn('Unable to process role of type: ' + info.type);
    }
  } catch (error) {
    logger.warn('Unable to load role: ' + infopath + ': ' + error);
  }
}

RolesCache.prototype.removeRoles = function() {
  var self = this;

  // Remove roles that
  // - Do not apply to this platform

  config.EXCLUDE_ROLES.forEach(function(rolename) {
    self.singletonRoles_.remove(function(info) {
      return info.name === rolename;
    });
    
    self.scalableRoles_.remove(function(info) {
      return info.name === rolename;
    });
  });

  if (config.INCLUDE_ROLES.length > 0) {
    self.singletonRoles_.remove(function(info) {
      return config.INCLUDE_ROLES.findIndex(info.name) === -1;
    });

    self.scalableRoles_.remove(function(info) {
      return config.INCLUDE_ROLES.findIndex(info.name) === -1;
    });
  }
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