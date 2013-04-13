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
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Notices = acquire('notices')
  , Role = acquire('role')
  , Seq = require('seq')
  ;

var NoticeSender = module.exports = function() {
  this.campaigns_ = null;
  this.hosts_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.notices_ = null;

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
  self.hosts_ = new Hosts();
  self.infringements_ = new Infringements();
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

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

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
      self.batchInfringements(infringements, this);
    })
    .seq(function(batched) {
      self.processBatches(batched, this);
    })
    .seq(function() {
      logger.info('Done');
    })
    .catch(function(err) {
      console.warn(err);
    })
    ;
}

NoticeSender.prototype.batchInfringements = function(infringements, done) {
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
        logger.warn('Error processing %s: %s', link.uri, err);
      }
    }

    if (map[key]) {
      map[key].infringements.push(link);
    } else {
      map[key] = {
        key: key,
        infringements: [link]
      };
    }
  });

 done(null, Object.values(map));
}

NoticeSender.prototype.processBatches = function(batches, done) {
  var self = this
    ;

  Seq(batches)
    .seqEach(function(batch) {
      logger.info('%s has %d infringements', batch.key, batch.infringements.length);
      self.processBatch(batch, this);
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      logger.warn('Error processing batches %j: %s', batches, err);
      done(err);
    })
    ;
}

NoticeSender.prototype.processBatch = function(batch, done) {
  var self = this;

  Seq()
    .seq(function() {
      self.hosts_.get(batch.key, this);
    })
    .seq(function(host) {
      if (!host || !host.noticeDetails) {
        logger.warn('Host "%s" does not exist', batch.key);
        return done();
      }

      batch.host = host;
      this();
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      logger.warn('Error processing batch %j: %s', batch, err);
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