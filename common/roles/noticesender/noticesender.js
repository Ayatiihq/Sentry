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
  , Jobs = acquire('jobs')
  , Notices = acquire('notices')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Seq = require('seq')
  , database = acquire('database')  
  ;

var EmailEngine = require('./email-engine')
  , NoticeBuilder = require('./notice-builder')
  ;

var NoticeSender = module.exports = function() {
  this.campaigns_ = null;
  this.clients_ = null;
  this.hosts_ = null;
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
    logger.warn(err.stack);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);

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
    .seq(function(client) {
      self.sendEscalatedNotices(this);
    })    
    .seq(function() {
      logger.info('Finished sending notices');
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

NoticeSender.prototype.getInfringements = function(done) {
  var self = this;

  // If a client doesn't have the required information, we skip it
  if (!self.client_.authorization || !self.client_.copyrightContact) {
    logger.info('Client %s does not have the required information to process notices', self.client_.name);
    return done();
  }

  if (self.campaign_.monitoring) {
    logger.info('Campaign %s is for monitoring only', self.campaign_.name);
    return done();
  }

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

    if (link.scheme == 'torrent' || link.scheme == 'magnet')
      return;

    if (link.meta) {
      key = link.source;
    } else {
      try {
        var uri = URI(link.uri);

        if (uri.domain().length < 1)
          uri = URI(link.uri.unescapeURL());
        key = uri.domain().toLowerCase();

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
  var self = this
    , categoryFilters = self.campaign_.metadata.noticeCategoryFilters
    ;

  Seq()
    .seq(function() {
      self.hosts_.get(batch.key, this);
    })
    .seq(function(host) {
      if (!host) {
        logger.warn('Host "%s" does not exist', batch.key);
        // We add it to the DB to be processed
        host = {
          _id: batch.key,
          name: batch.key,
          uri: batch.key
        };
        self.hosts_.add(host);
        return done();
      
      } else if (!host.noticeDetails) {
        logger.warn('Host "%s" does not have noticeDetails', batch.key ? batch.key : batch.infringements[0].uri);
        return done();
      
      } else if (categoryFilters && !categoryFilters.some(host.category)) {
        logger.info('Host %s (%s) does not match allowed noticing categories.', host._id, states.infringements.categoryNames[host.category]);
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
    , settingsKey = self.campaigns_.hash(self.campaign_) + '.' + host._id
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
      self.sendFirstNotice(host, infringements, this);
    })
    .seq(function() {
      done();
    })
    .catch(function(err) {
      logger.warn('Error processing batch for %j: %s', host, err.stack);
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

  if (!triggers)
    return false;

  Object.keys(triggers).forEach(function(trigger) {
    var value = triggers[trigger];

    switch(trigger) {
      case 'minutesSinceLast':
        logger.info('Checking if %s\'s last notice (%s) was sent before %s minutes ago',
                     host._id, Date.utc.create(lastTriggered), value);
        if (Date.utc.create(lastTriggered).isBefore(value + ' minutes ago'))
          triggered = true;
        break;

      case 'pendingNotices':
        logger.info('Checking if %s\'s pending notices (%d) are greater than threshold %d',
                    host._id, infringements.length, value);
        if (infringements.length > value)
          triggered = true;
        break;

      default:
        console.warn('%s is an unsupported trigger', trigger);
    }
  });

  return triggered;
}

NoticeSender.prototype.sendNotice = function(host, infringements, done) {
  var self =  this;

  logger.info('Sending notice for %s', host._id);

  Seq()
    .seq(function() {
      var builder = new NoticeBuilder(self.client_, self.campaign_, host, infringements);
      builder.build(this);
    })
    .seq(function(hash, message) {
      self.loadEngineForHost(host, infringements, hash, message, this);
    })
    .seq(function(engine) {
      engine.post(done);
    })
    ;
}

NoticeSender.prototype.sendFirstNotice = function(host, infringements, done) {
  var self =  this
    , settingsKey = self.campaigns_.hash(self.campaign_) + '.' + host._id
    ;

  logger.info('Sending First notice to %s', host._id);

  Seq()
    .seq(function() {
      self.sendNotice(host, infringements, this);
    })
    .seq(function(notice) {
      self.processNotice(host, notice, this);
    })
    .seq(function() {
      if (!details.testing) {
        host.settings.lastTriggered = Date.now();
        self.settings_.set(settingsKey, host.settings);
      }
      done();
    })
    .catch(function(err) {
      logger.warn('Unable to send notice to %s: %s', host._id, err);
      done(err);
    })
    ;
}

NoticeSender.prototype.sendEscalatedNotices = function(done){
  var self = this;
  // If a client doesn't have the required information, we skip it
  if (!self.client_.authorization || !self.client_.copyrightContact) {
    logger.info('Client %s does not have the required information to process notices',
                 self.client_.name);
    return done();
  }

  if (self.campaign_.monitoring) {
    logger.info('Campaign %s is for monitoring only', self.campaign_.name);
    return done();
  }

  self.notices_.getNeedsEscalatingForCampaign(self.campaign_, function(err, results){
    if(err){
      logger.warn('Error fetching notices that need-escalating : ' + err);
      return done(err);
    }

    Seq(results)
      // expand the host information on the notice.
      .seqEach(function(notice){
        var that = this;
        self.hosts_.get(notice.host, function(err, host){
          if(err)
            return that(err);
          notice.host = host;
          that();
        });
      })
      // filter out notices that have hosts that don't have hostedBy
      .seqFilter(function(notice){
        if(!notice.host || !notice.host.hostedBy){
          logger.info('Want to escalate notice for ' + host.name " but don't have hostedBy information.")
          return false;          
        }
        return true;
      }) 
      // expand the hostedBy information on the notice.
      .seqEach(function(notice){
        var that = this;
        self.hosts_.get(notice.host.hostedBy, function(err, host){
          if(err)
            return that(err);
          notice.hostedBy = host;
          that();
        });
      })
      // expand all infringements on the valid notices to be escalated 
      .seqEach(function(notice){
        var that = this;
        var ids = [];
        notice.infringements.each(function(infr_id){
          ids.push({'_id': infr_id});
        });
        database.connectAndEnsureCollection('infringements', function(err, db, collection){
          if(err)
            return that(err);
          collection.find({'$or' : ids}).toArray().each(function(err, results){
            if(err)
              return that(err);
            notice.infringements = results;
            that();
          });
        });
      })
      // send escalated notices to the hosts of the domain
      .seqEach(function(notice){
        var that = this;
        logger.info('sending escalated notice for ' + notice.host.name + ' to ' + notice.hostedBy.name);
        self.sendNotice(notice.hostedBy,
                        notice.infringements,
                        function(err, escalatedNotice){
                          if(err)
                            return that(err);
                          self.notices_.addEscalated(notice, escalatedNotice, that)
                        });
      .seq(function(){
        logger.info('finished with escalating notices');
        done();
      })
      .catch(function(err) {
        done(err)
      })
      ;
  });
}

NoticeSender.prototype.loadEngineForHost = function(host, infringements, hash, message, done) {
  var self = this
    , engine = null
    , err = null
    ;

  switch (host.noticeDetails.type) {
    case 'email':
      engine = new EmailEngine(self.client_, self.campaign_, host, infringements, hash, message);
      break;

    default:
      var msg = util.format('No engine available of type %s for %s',
                             host.noticeDetails.type, host._id);
      err = new Error(msg);
  }

  done(err, engine);
}


NoticeSender.prototype.processNotice = function(host, notice, done) {
  var self = this;

  if (host.noticeDetails.testing) {
    logger.info('Ignoring notice %s, this is a test run', notice._id);
    return done();
  }

  self.notices_.add(self.campaign_, notice, function(err) {       
    if (err) {
      logger.warn('Unable to add notice %j: %s', notice, err);
    } else {
      logger.info('Successfully added notice %s', notice._id);
    }
    done();
  });
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
  // Don't do anything, just let noticesender finish as normal, it's pretty fast
}