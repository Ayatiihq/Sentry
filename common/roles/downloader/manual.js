/*
 * manual.js: 
 * 
 * (C) 2014 Ayatii Limited
 * For any bespoke downloader (legacy pattern)
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('manual.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Approach = require('./approach')
  , Seq = require('seq')
  ;

var Manual = module.exports = function (campaign, targetHost) {
  this.constructor.super_.call(this, campaign, targetHost);
};

util.inherits(Manual, Approach);

Mangling.prototype.init = function(){
  var self = this;
  self.setupIgnores();
}

Manual.prototype.download = function(infringement, done) {
  var self = this
    , tmpDir = path.join(os.tmpDir(), 'downloader-' + Date.now() + '-' + infringement._id)
    , started = Date.now()
    , newState = states.infringements.state.UNVERIFIED
    ;

  logger.info('Downloading %s to %s', infringement.uri, tmpDir);

  Seq()
    .seq(function() {
      rimraf(tmpDir, this);
    })
    .seq(function() {
      fs.mkdir(tmpDir, this);
    })
    .seq(function() {
      // Get the file however you need to.
    })
    .seq(function() {
      self.storage_.addLocalDirectory(infringement.campaign, tmpDir, this);
    })
    .seq(function(nUploaded) {
      // TODO - needs to be integrated into whatever manual process needs it
      rimraf(tmpDir, this);
    })    
    .seq(function() {
      done();
    })
    .catch(function(err){
      logger.warn('Unable to goManual : %s', err);
      done(err);
    })
    ;
}

Manual.prototype.name = function(){
  var self = this;
  return 'Manual downloading for ' + self.host_._id;
}

Manual.prototype.finish = function(done){
  // clean up.
}