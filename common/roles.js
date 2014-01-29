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
  , path = require('path')
  , util = require('util')
  ;

var ROLES_DIR = __dirname + '/roles/';

var Roles = module.exports = function() {
  this.ready_ = false;
  this.roles_ = [];

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
    self.loadRoleInfo(ROLES_DIR + file + '/package.json');
  });

  self.removeRoles();

  self.ready_ = true;
  self.emit('ready');
}

Roles.prototype.loadRoleInfo = function(infopath) {
  var self = this;

  logger.info('Loading role: ' + infopath);

  try {
    var info = require(infopath);

    if (info.disabled) {
      logger.info(util.format('Ignoring role %s: It is disabled', info.name));
      return;
    }

    // Sanitize for usage
    info.queues = info.queues ? info.queues : [];
    info.dependencies = info.dependencies ? info.dependencies : {};

    self.roles_.push(info);

  } catch (error) {
    logger.warn('Unable to load role: ' + infopath + ': ' + error);
  }
}

Roles.prototype.loadRole = function(roleName) {
  var self = this
    , target = path.join(ROLES_DIR, roleName)
    , instance = null
  ;

  logger.info('Loading role: ' + target);

  try {
    var role = require(target);
    instance = new role();
  } catch (error) {
    logger.warn('Unable to load role: ' + target + ': ' + error);
  }
  return instance;
}

Roles.prototype.removeRoles = function() {
  var self = this;

  // Remove roles that
  // - Do not apply to this platform

  config.EXCLUDE_ROLES.forEach(function(rolename) {
    self.roles_.remove(function(info) {
      return info.name === rolename;
    });
  });

  if (config.INCLUDE_ROLES.length > 0) {
    self.roles_.remove(function(info) {
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

Roles.prototype.getRoles = function() {
  return this.roles_;
}