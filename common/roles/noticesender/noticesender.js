/*
 * noticesender.js: the noticesender
 *
 * (C) 2012 Ayatii Limited
 *
 * NoticeSender processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('noticesender.js')
  , Seq = require('seq')
  , states = acquire('states')
  , util = require('util')
  , URI = require('URIjs')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Notices = acquire('notices')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Seq = require('seq')
  ;

var MAX_LINKS = 100;

var NoticeSender = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.settings_ = null;
  this.jobs_ = null;
  this.verifications_ = null;

  this.started_ = false;

  this.touchId_ = 0;
  this.timestampIsVerified_ = true;

  this.job_ = null;

  this.init();
}

util.inherits(NoticeSender, Role);

NoticeSender.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.settings_ = new Settings('role.noticesender');
  self.jobs_ = new Jobs('noticesender');
  self.notices_ = new Notices();
}

NoticeSender.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  self.campaigns_.getDetails(job._id.owner, function(err, campaign) {
    if (err) {
      self.emit('error', err);
      return;
    }

    self.job_ = job;
    self.campaign_ = campaign;
    
    self.getInfringements();
  });
}

NoticeSender.prototype.getInfringements = function() {
  var self = this;

  Seq()
    .seq(function() {
      self.notices_.getReadyForNotice(self.campaign_, this);
    })
    .seq(function(infringements) {
      self.collectInfringements(infringements, this);
    })
    .seq(function(collected) {
      self.goPostal(collected, this);
    })
    .seq(function() {
      console.log('Done');
    })
    .catch(function(err) {
      console.error(err);
    })
    ;
}

NoticeSender.prototype.collectInfringements = function(infringements, done) {
  var self = this
    , map = {}
    ;

  infringements.forEach(function(link) {
    var key = 'unknown';

    if (link.meta) {
      key = link.source;
    } else {
      try {
        var uri = URI(link.uri);

        if (uri.domain().length < 1)
          uri = URI(link.uri.unescapeURL());
        key = uri.domain();

      } catch (err) { 
        console.warn('Error processing %s: %s', link.uri, err);
      }
    }

    if (map[key]) {
      map[key].infringements.push(link);
    } else {
      map[key] = {
        domain: key,
        infringements: [link]
      };
    }
  });

 done(null, Object.values(map));
}

NoticeSender.prototype.goPostal = function(collected, done) {
  var self = this
    ;

  Seq(collected)
    .seqEach(function(host) {
      console.log('%s has %d links', host.domain, host.infringements.length);
      if (host.domain.length < 1)
        console.log(JSON.stringify(host, null, '\t'));
      this();
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      console.error(err);
      done();
    })
    ;
}


//
// Overrides
//
NoticeSender.prototype.getName = function() {
  return "noticesender";
}

NoticeSender.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

NoticeSender.prototype.end = function() {
  var self = this;

  self.started_ = false;

  self.emit('ended');
}