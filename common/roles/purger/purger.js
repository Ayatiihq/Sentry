/*
 * purger.js: the Purger
 *
 * (C) 2014 Ayatii Limited
 *
 * Purger thrashes all unnecessary data/files after an infringement is categorised as
 * false positive/unavailable or verified.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , fmt = require('util').format
  , fs = require('fs')
  , logger = acquire('logger').forFile('purger.js')
  , os = require('os')
  , path = require('path')
  , rimraf = require('rimraf')
  , states = acquire('states')
  , util = require('util')  
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , Storage = acquire('storage')
  , Verifications = acquire('verifications')
  ;

var PROCESSOR = 'purger';

var Purger = module.exports = function() {
  this.campaigns_ = null;
  this.downloads_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.storage_ = null;
  this.verifications_ = null;

  this.campaign_ = null;

  this.started_ = 0;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Purger, Role);

Purger.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('purger');
  self.storage_ = new Storage('downloads');
  self.verifications_ = new Verifications();
}


Purger.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  // Keep job alive
  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);


  // Error out nicely, closing the job too
  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack, console.trace());
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);
  var iStates = states.infringements.states
    ;

  // Now we process jobs
  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.infringements_.getPurgable(self.campaign_, this);
    })
    .seq(function(theGreatUnwashed_){
      self.goPurge(theGreatUnwashed_, this);
    })
    .seq(function() {
      logger.info('Finished purger session for ' + self.campaign_.name);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to process job %j: %s', job, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Purger.prototype.goPurge = function(theGreatUnwashed, done){
  var self = this
    , dldMd5s = []
  ;

  Seq(theGreatUnwashed)
    .seqEach(function(infringement) {
      self.purge(infringement, this);
    })   
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

// Should we delete downloads from verified infringements.
// Do we need to keep these for the dashboard.
Purger.prototype.purge = function(infringement, done){
  var self = this
    , dldMd5s = []
  ;

  dldMd5s = infringement.downloads ? infringement.downloads.map(function(dld){ return dld.md5}) : [];

  Seq()
    .seq(function(){
      if(dldMd5s.isEmpty())
        return this();
      self.verifications_.get({md5s : dldMd5s}, this);
    })
    .seq(function(verifications){
      if(dldMd5s.isEmpty())
        return this();      
      self.deleteDownloads(infringement, verifications, this);
    })
    .seq(function(){      
      self.removeTheFat(infringement, this);
    })
    .seq(function(){
      logger.trace('done purging ' + infringement._id);
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Purger.prototype.removeTheFat = function(infringement, done){
  var self = this;

  Seq()
    .seq(function(){
      self.infringements_.purge(infringement,
                                this);
    })
    .seq(function(){
      self.infringements_.processedBy(infringement, self.getName(), done);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Purger.prototype.deleteDownloads = function(infringement, verifications, done){
  var self = this
    , previous = {}
  ;

  verifications.each(function(verification){
    previous[verification._id.md5] = verification;
  })

  Seq(infringement.downloads)
    .seqEach(function(download){
      var that = this;
      
      if(!Object.keys(previous).some(download.md5)){
        self.deleteUnverifiedDownload(infringement, download, that); 
      }
      else if(previous[download.md5].verified){
        // don't delete verified download md5s (dashboard needs 'em')
        logger.info('This is a verified download, leave it where it is.');
        that();
      }
      else if(previous[download.md5].verified === false){
        // Otherwise if its set to false, nuke it. 
        self.deleteDownload(infringement, download, that);
      }
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done('Error deleting downloads from S3 for infringement : ' + infringement.uri + '\n' + err);
    })
    ;
} 

Purger.prototype.deleteDownload = function(infringement, download, done){
  var self = this;
  self.storage_.deleteFile(infringement.campaign, download.md5, function(err){
    if(err)
      return done(err);
    logger.info('just purged download ' + download.md5);
    self.infringements_.downloadProcessedBy(infringement, download.md5, self.getName(), done);
  });
}
/*
 * This will only delete a download which has no verification associated with it
 * & only if no other infringements have it as a download. 
 */
Purger.prototype.deleteUnverifiedDownload = function(infringement, download, done)
{
  var self = this;
  Seq()
    .seq(function(){
      self.infringements_.getForDownload(download, this);
    })
    .seq(function(infrgs_){
      if((infrgs_.length === 1 && infrgs_.first()._id === infringement._id) ||
        infrgs_.isEmpty()){
        self.deleteDownload(infringement, download, this);
      }
      else{
        logger.info("Looks like other infringements (of relevance) might be pointing at this download, dont delete");
        logger.info('And they are ' + JSON.stringify(infrgs_));
      }
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

//
// Overrides
//
Purger.prototype.getName = function() {
  return "purger";
}

Purger.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Purger.prototype.end = function() {
  var self = this;

  self.started_ = false;
}
