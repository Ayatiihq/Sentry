/*
 * downloads.js: verification actions
 *
 * Wraps the verification actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , crypto = require('crypto')
  , database = acquire('database')
  , logger = acquire('logger').forFile('downloads.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq');

/**
 * Wraps the downloads table.
 * 
 * @return {object}
 */
var Downloads = module.exports = function() {
  this.db_ = null;
  this.downloads_ = null;
  this.infringements_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Downloads.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, infringements) {
      self.db_ = db;
      self.infringements_ = infringements;
      database.connectAndEnsureCollection('downloads', this);
    })
    .seq(function(db, downloads) {
      self.downloads_ = downloads;
      this();
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
/**
 * Get a unique name depending on the strings passed in.
 * Use to generate a name for a download file depending on it's url [filename] etc.
 * Produces a hash.
 *
 * Ex: generateName(infringement.uri, nameOfFile)
 *
 * @param  {string}      uri           The initial component to hash
 * @param  {strings}     [components]  More components to generate a unique name
 * @return {string}     name
 */
Downloads.prototype.generateName = function() {
  var string = '';

  Object.values(arguments, function(arg) {
    if (arg) string += arg;
  });

  var shasum = crypto.createHash('sha1');
  shasum.update(string);
  return shasum.digest('hex');
}