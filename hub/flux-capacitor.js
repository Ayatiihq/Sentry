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

var Dependencies = require('./dependencies')
  , Jobs = acquire('jobs')
  , Roles = acquire('roles')
  , Seq = require('seq')
  ;


var FluxCapacitor = module.exports = function() {
  this.dependencies_ = null;
  this.roles_ = null;

  this.jobs_ = {};

  this.init();
}

util.inherits(FluxCapacitor, events.EventEmitter);

FluxCapacitor.prototype.init = function() {
  var self = this;

  self.dependencies_ = new Dependencies();
  self.roles_ = new Roles();
  self.roles_.on('ready', self.loadQueuesAndInitRole.bind(self));
}

FluxCapacitor.prototype.loadQueuesAndInitRole = function() {
  var self = this
    , roles = self.roles_.getRoles()
    ;

  roles.forEach(function(role) {
    role.lastRun_ = Date.now();
    role.nRuns_ = 0;
    self.jobs_[role.name] = new Jobs(role.name);
  });
}

FluxCapacitor.prototype.getRoleTotalQueueLength = function(role, callback) {
  var self = this
    , totalLength = 0
    ;

  self.jobs_[role.name].nAvailableJobs(function(err, count) {
    if (err)
      logger.warn(err);

    callback(err ? 0 : count);
  });
}

FluxCapacitor.prototype.getRoleDependenciesAvailable = function(role, callback) {
  var self = this
    , allDepsAvailable = true
    , deps = role.dependencies
    ;

  Seq(Object.keys(deps))
    .parEach(function(dependency) {
      var that = this
        , depArgs = deps[dependency]
        ;
      self.dependencies_.isAvailable(dependency, depArgs, function(err, available) {
        if (!available) {
          logger.info('Role %s\'s dependencies are not currently available', role.name);
          allDepsAvailable = false;
        }
        that();
      });
    })
    .seq(function() {
      callback(allDepsAvailable);
    })
    ;
}

//
// Public
//
FluxCapacitor.prototype.getWork = function(callback) {
  var self = this
    , roles = self.roles_.getRoles()
    ;

  callback = callback ? callback : function() {};

  Seq(roles)
    // Filter out those without work to do
    .parFilter(function(role) {
      var that = this;
      self.getRoleTotalQueueLength(role, function(length) {
        that(null, length);
      });
    })
    // Filter out those with dependencies busy
    // use seq to take advantage of caching
    .seqFilter(function(role) {
      var that = this;
      self.getRoleDependenciesAvailable(role, function(available) {
        that(null, available);
      });
    })
    // Sort by oldest that was run for now, choose oldest to send to worker
    .seq(function() {
     this(null, this.stack.sortBy(function(role) {
        return role.lastRun_;
      })[0]);
    })
    .seq(function(role) {
      var work = { };
      if (role) {
        role.lastRun_ = Date.now();
        role.nRuns_ += 1;
        work.rolename = role.name;
        callback(work);
      }
    })
    ;
}
