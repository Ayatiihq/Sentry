/*
 * roles.js: managing the available roles
 *
 * (C) 2012 Ayatii Limited
 *
 * Roles compiles a cache of all the available roles so the scheduler can
 * easily enumerate them.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fs = require('fs')
  , logger = acquire('logger').forFile('roles.js')
  , util = require('util')
  ;

var ROLES_DIR = __dirname + '/roles/';

var Roles = module.exports = function() {
  this.ready_ = false;
  this.singletonRoles_ = [];
  this.scalableRoles_ = [];

  this.init();
}

util.inherits(Roles, events.EventEmitter);

Roles.prototype.init = function() {
  var self = this;

  // Works from toplevel
  fs.readdir(ROLES_DIR, self.onRolesDirRead.bind(self));
}

Roles.prototype.onRolesDirRead = function(err, files) {
  var self = this;

  files.forEach(function(file) {
    if (file.endsWith('.js') || file[0] === '.')
      return;
    self.loadRole(ROLES_DIR + file + '/package.json');
  });

  self.removeRoles();

  self.ready_ = true;
  self.emit('ready');
}

Roles.prototype.loadRole = function(infopath) {
  var self = this;

  logger.info('Loading role: ' + infopath);

  try {
    var info = require(infopath);

    if (info.disabled) {
      logger.info(util.format('Ignoring role %s: It is disabled', info.name));
      return;
    }
    
    if (info.type === 'singleton') {
      self.singletonRoles_.push(info);
    
    } else if (info.type === 'scalable') {
      self.scalableRoles_.push(info);
    
    } else {
      logger.warn('Unable to process role of type: ' + info.type);
    }
  } catch (error) {
    logger.warn('Unable to load role: ' + infopath + ': ' + error);
  }
}

Roles.prototype.removeRoles = function() {
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
Roles.prototype.isReady = function() {
  return this.ready_;
}

Roles.prototype.getSingletonRoles = function() {
  return this.singletonRoles_;
}

Roles.prototype.getScalableRoles = function() {
  return this.scalableRoles_;
}