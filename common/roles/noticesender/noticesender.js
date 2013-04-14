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
  , states = acquire('states')
  , util = require('util')
  , URI = require('URIjs')
  ;

var Campaigns = acquire('campaigns')
  , Clients = acquire('clients')
  , Hosts = acquire('hosts')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Notices = acquire('notices')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Seq = require('seq')
  ;

var EmailEngine = require('./email-engine');

var NoticeSender = module.exports = function() {
  this.campaigns_ = null;
  this.clients_ = null;
  this.hosts_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.notices_ = null;
  this.settings_ = null;

  this.engines_ = {};

  this.started_ = false;

  this.touchId_ = 0;
  this.timestampIsVerified_ = true;

  this.job_ = null;
  this.campaign_ = null;

  this.init();
}

util.inherits(NoticeSender, Role);

NoticeSender.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.clients_ = new Clients();
  self.hosts_ = new Hosts();
  self.infringements_ = new Infringements();
  self.jobs_ = new Jobs('noticesender');
  self.notices_ = new Notices();
  self.settings_ = new Settings('role.noticesender');
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

  Seq()
    .seq(function() {
      self.job_ = job;
      self.campaigns_.getDetails(job._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      self.clients_.get(campaign._id.client, this);
    })
    .seq(function(client) {
      self.client_ = client;
      self.getInfringements(this);
    })
    .seq(function() {
      logger.info('Done');
    })
    .catch(function(err) {
      logger.warn('Unable to process job %j: %s', job, err);
    })
    ;
}

NoticeSender.prototype.getInfringements = function(done) {
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
      done()
    })
    .catch(function(err) {
      done(err)
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
      self.checkAndSend(host, batch.infringements, done);
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

NoticeSender.prototype.checkAndSend = function(host, infringements, done) {
  var self = this
    , settingsKey = self.campaigns_.hash(self.campaign_)
    ;

  Seq()
    .seq(function() {
      self.settings_.get(settingsKey, this);
    })
    .seq(function(settings) {
      host.settings = settings ? settings : {};

      if (!self.hostTriggered(host, infringements)) {
        logger.info('None of the triggers are met for %s, moving on', host._id);
        return done();
      }
      self.sendNotice(host, infringements, this);
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      logger.warn('Error processing batch for %s: %s', host, err);
      done();
    })
    ;
}

//
// Checks that any of the hosts triggers have been, er, triggered.
//
NoticeSender.prototype.hostTriggered = function(host, infringements) {
  var self = this
    , triggered = false
    , triggers = host.noticeDetails.triggers
    , lastTriggered = host.settings.lastTriggered
    ;

  lastTriggered = lastTriggered ? lastTriggered : 0;

  Object.keys(triggers).forEach(function(trigger) {
    var value = triggers[trigger];

    switch(trigger) {
      case 'minutesSinceLast':
        if (Date.create(lastTriggered).isBefore(value + ' minutes ago'))
          triggered = true;
        break;

      case 'pendingNotices':
        if (infringements.length > value)
          triggered = true;

      default:
        console.warn('%s is an unsupported trigger', trigger);
    }
  });

  return triggered;
}

NoticeSender.prototype.sendNotice = function(host, infringements, done) {
  var self =  this
    , noticeDetails = host.noticeDetails
    ;

  var engine = self.loadEngineForHost(host);
  if (!engine) {
    var err = util.format('No engine available of type %s for %s',
                          noticeDetails.type, host._id);
    return done(new Error(err));
  }

  engine.on('notice', function(notice) {
    console.log(notice);
    // Add notice to db
  });
  engine.goPostal(done);
}

NoticeSender.prototype.loadEngineForHost = function(host, infringements) {
  var self = this;

  switch (host.noticeDetails.type) {
    case 'email':
      return new EmailEngine(self.client_, self.campaign_, host, infringements);

    default:
      return null;
  }
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