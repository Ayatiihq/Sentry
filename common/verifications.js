/*
 * verifications.js: verification actions
 *
 * Wraps the verification actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('verifications.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var Seq = require('seq');

/**
 * Wraps the verifications table.
 * 
 * @return {object}
 */
var Verifications = module.exports = function() {
  this.db_ = null;
  this.infringements_ = null;
  this.verifications_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Verifications.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, infringements) {
      self.db_ = db;
      self.infringements_ = infringements;
      database.connectAndEnsureCollection('verifications', this);
    })
    .seq(function(db, verifications) {
      self.verifications = verifications;
    })
    .seq(function() {
      self.cachedCalls_.forEach(function(call) {
        call[0].apply(self, call[1]);
      });
      self.cachedCalls_ = [];
    })
    .catch(function(err) {
      logger.warn('Unable to initialise %s', err);
    })
    ;
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

//
// Public Methods
//