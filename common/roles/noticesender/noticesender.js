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
  , database = acquire('database')
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
  , Storage = acquire('storage')   
  , Settings = acquire('settings')
  , Seq = require('seq')
  , Handlebars = require('handlebars')
  ;

var Categories = states.infringements.category
  , CategoryNames = states.infringements.categoryNames
  , Cyberlockers = []
  , EmailEngine = require('./email-engine')
  , NoticeBuilder = require('./notice-builder')
  , TorrentSites = []
  , WebFormEngine = require('./webform-engine')
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
  this.storage_ = null;

  Role.call(this);
  this.init();
}

util.inherits(NoticeSender, Role);

NoticeSender.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.clients_ = new Clients();
  self.hosts_ = new Hosts();
  self.jobs_ = new Jobs('noticesender');
  self.storage_ = new Storage('notices'); 
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
    logger.warn(err.stack, console.info());
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
      self.noticeInfo_ = campaign.noticeInfo || {};
      self.clients_.get(campaign.client, this);
    })
    .seq(function(client) {
      self.client_ = client;
      self.hosts_.getDomainsByCategory(Categories.CYBERLOCKER, this);
    })
    .seq(function(cyberlockers) {
      Cyberlockers = cyberlockers;
      self.hosts_.getDomainsByCategory(Categories.TORRENT, this);
    })
    .seq(function(torrentSites) {
      TorrentSites = torrentSites;
      self.getInfringements(this);
    })
    .seq(function(){
      self.notices_.getNeedsEscalatingForCampaign(self.campaign_, this);
    })
    .seq(function(escalateUs){
      var that = this;
      database.connectAndEnsureCollection('infringements', function(err, db, table){
        if(err)
          return that(err);
        self.sendEscalatedNotices(escalateUs, table, that);  
      });      
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
  if (!self.noticeInfo_.authorization || !self.noticeInfo_.copyrightContact) {
    logger.info('Campaign %s does not have the required information to process notices', self.campaign_.name);
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

//
// This function decides of a search engine result belongs in a category or not (for filtering)
//
function metaLinkBelongsInCategories(link, categories) {
  
  if (categories.indexOf(Categories.CYBERLOCKER) > -1) {
    var matched = Cyberlockers.some(function(cyberlocker) {
      return link.uri.has(cyberlocker);
    });
    if (matched)
      return true;
  }

  if (categories.indexOf(Categories.TORRENT) > -1) {
    var matched = TorrentSites.some(function(torrentSite) {
      return link.uri.has(torrentSite);
    });
    if (matched)
      return true;
  }

  // We don't support other types of filtering yet
  return false;
}

NoticeSender.prototype.batchInfringements = function(infringements, done) {
  var self = this
    , map = {}
    , categoryFilter = self.noticeInfo_.categoryFilter || []
    ;

  if (categoryFilter.length)
    logger.debug('Performing filtering of categories for noticesending. Categories ', categoryFilter.map(function(cat) { return CategoryNames[cat]; }));

  infringements.forEach(function(link) {
    var key = 'unknown';

    if (link.scheme == 'torrent' || link.scheme == 'magnet')
      return;

    // Check if we have to filter out certain types of infringements
    if (categoryFilter.length) {
      if (link.meta) {
        if (!metaLinkBelongsInCategories(link, categoryFilter))
          return;
      }
      else if (categoryFilter.indexOf(link.category) == -1)
        return;
    }

    if (link.meta) {
      key = link.source;
    } else {
      try {
        var uri = URI(link.uri);

        if (uri.domain().length < 1)
          uri = URI(link.uri.unescapeURL());
        key = uri.domain().toLowerCase();
        
        if (key.length == 0) {
          logger.warn('Unable to find domain of', link.uri);
          return;
        }

      } catch (err) { 
        logger.warn('Error processing %s', link.uri, err);
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
    .seq(function (host) {
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
      
      } else if (!host.noticeDetails.type && !host.hostedby) {
        logger.warn('Host "%s" does not have engine type, nor hostedBy to escalate', 
                    batch.key ? batch.key : batch.infringements[0].uri);
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
    , settingsKey = self.campaign_._id + '.' + host._id
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
  var self =  this
    , details = host.noticeDetails
    , settingsKey = self.campaign_._id + '.' + host._id
    , notice = null
    , message = null
    ;

  logger.info('Sending notice to %s', host._id);
  host.campaign = self.campaign_;
  host.client = self.client_;
  host.infringements = infringements;
  
  if (host.noticeDetails.type === undefined) {
    var err = new Error(acquire('logger').dictFormat('Host "${host}" has an undefined type.', { 'host': host.name }));
    done(err);
    return;
  }

  // Make sure host is as valid as possible
  host.noticeDetails.metadata = host.noticeDetails.metadata || {};
  host.noticeDetails.metadata.template = host.noticeDetails.metadata.template || 'dmca';

  Seq()
    .seq(function () {
      var builder = new NoticeBuilder(self.client_, self.campaign_, host, infringements);
      builder.build(this);
    })
    .seq(function(hash, msg) {
      notice = self.prepareNotice(hash, host, infringements);
      message = msg;
      self.processNotice(host, notice, this);
    })
    .seq(function(){
      //  first check to see if we can escalate this mother
      if(self.hosts_.shouldAutomateEscalation(host)){
        logger.info('Automatically escalating notice ' + notice._id + ' from host ' + host.name + ' to ' + host.hostedBy);
        self.notices_.setState(notice, states.notices.state.NEEDS_ESCALATING, done);
        return;
      }        
      this(null, message, notice);
    })
    .seq(function(message, notice) {
      self.loadEngineForHost(host, message, notice, this);
    })
    .seq(function (engine, message, notice) {
      engine.post(host, message, notice, this);
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
      if(notice){
        self.notices_.revert(notice, done.bind(null, err));
      }
    })
    ;
}

NoticeSender.prototype.sendEscalatedNotices = function(escalateThese, infringementsTable, done){
  var self = this
    ;

  if (self.campaign_.monitoring) {
    logger.info('Campaign %s is for monitoring only', self.campaign_.name);
    return done();
  }

  Seq(escalateThese)
    .seqEach(function(notice){
      console.log('escalate this ' + JSON.stringify(notice));
      self.escalateNotice(notice, infringementsTable, this);
    })
    .seq(function(){
      logger.info('finished with escalating notices');
      done();
    })    
    .catch(function(err){
      logger.warn('Error fetching notices that need escalating : ' + err);
      done(err);
    })
    ;
}

NoticeSender.prototype.escalateNotice = function(notice, infringementsTable, done){
  var self = this;
  
  logger.info('escalate notice - ' + notice._id);

  Seq()
    .seq(function(){
      // Flesh out the original host
      var that = this;
      self.hosts_.get(notice.host, function(err, host){
        if(err){
          logger.warn('Unable to fetch (for some reason) the original host for the intended escalated notice : ' + host);
          return done();
        }
        if(!host.serverInfo || !host.serverInfo.ipAddress || host.serverInfo.ipAddress.replace(/\s/g, "") === ""){
          logger.warn("We don't have the server ip for " + host.name + ' - cancelling escalation until we do have that IP.');
          return done(); 
        }
        notice.host = host;
        that(null, notice);
      });
    })
    .seq(function(noticeWithHost){
      // Flesh out the hostedby host.
      var that = this;
      if(!noticeWithHost.host.hostedBy || !noticeWithHost.host.hostedBy === ''){
        logger.info('Want to escalate notice for ' + noticeWithHost.host.name +  "but don't have hostedBy information.");
        return done();      
      }
      self.hosts_.get(noticeWithHost.host.hostedBy, function(err, targetHost_){
        // just because we have a hostedBy string doesn't necessarily mean we have the full host info.
        if(err || !targetHost_){
          // Be verbose.
          logger.info('Want to escalate notice to ' +
                      noticeWithHost.host.hostedBy + ' for ' +
                      noticeWithHost.host.name +  
                      " but don't have " + 
                      noticeWithHost.host.hostedBy + ' information');
          return done();
        }
        targetHost_.campaign = self.campaign_;
        targetHost_.client = self.client_;
        noticeWithHost.host.hostedBy = targetHost_;

        that(null, noticeWithHost);
      })
    })
    .seq(function(noticeWithHostedBy){
      var that = this;
      // finally grab the full infringements and populate
      infringementsTable.find({_id : {$in : noticeWithHostedBy.infringements}}).toArray(function(err, fullInfrigs){
        if(err){
          logger.warn("hmm this shouldn't happen, unable to explode infringements for escalation");
          return done(err);
        }
        noticeWithHostedBy.host.hostedBy.infringements = fullInfrigs;
        that(null, noticeWithHostedBy)
      });
    })
    .seq(function(completeNotice){
      logger.trace('escalate notice - have host.hostedBy');
      // Prepare escalation text
      var that = this;
      self.storage_.getToText(self.campaign_._id, notice._id, {}, function(err, originalMsg){
        if(err){
          logger.warn('Unable to retrieve original notice text for escalation - notice id : ' + notice._id);
          return done();
        }
        self.prepareEscalationText(completeNotice, originalMsg, that);
      });
    })
    .seq(function(escalationText, prepdNotice){
      self.loadEngineForHost(prepdNotice.host.hostedBy, escalationText, prepdNotice, this);
    })
    .seq(function(engine, escalationMessage, prepdNotice) {
      engine.post(prepdNotice.host.hostedBy, escalationMessage, prepdNotice, this);
    })
    .seq(function(escalatedNotice, target) {
      self.notices_.addEscalated(notice, target);
      self.notices_.setState(notice, states.notices.state.ESCALATED, this);
    })
    .seq(function(){
      logger.info('successfully escalated notice ' + notice._id + ' to ' + notice.host.hostedBy.name);
      done();
    })
    .catch(function(err) {
      // Don't error, let it move onto the next escalation.
      logger.warn('Escalation failed : ' +  err);
      done();
    })
    ;    
}

NoticeSender.prototype.prepareEscalationText = function(notice, originalMsg, done){
  var self = this;
  Seq()
    .seq(function(){
      self.storage_.getToText('templates', 'dmca.escalate', {}, this);
    })
    .seq(function(template) {
      var that = this;
      var target = notice.host.hostedBy.noticeDetails.manual ? notice.host.hostedBy.uri : notice.host.hostedBy.name 
      try {
        template = Handlebars.compile(template);
        context = {hostedBy : notice.host.hostedBy, 
                   website : notice.host,
                   offendingIP : notice.host.serverInfo.ipAddress,
                   recipientTarget : target,
                   originalNotice : originalMsg,
                   date : Date.utc.create().format('{dd} {Month} {yyyy}')};
        that(null, template(context));
      } catch (err) {
        that(err);
      }
    })
    .seq(function(message){
      done(null, message, notice);
    })
    .catch(function(err) {
      done(err);
    })    
    ;
}

NoticeSender.prototype.loadEngineForHost = function(host, message, notice, done) {
  var self = this
    , err = null
    ;

  var engines = [WebFormEngine, EmailEngine];
  var engineSelection = engines.find(function (engine) { return engine.canHandleHost(host); });

  if (engineSelection === null) {
      var msg = util.format('No engine available of type %s for %s',
                             host.noticeDetails.type, host._id);
      err = new Error(msg);
  }

  done(err, new engineSelection(), message, notice);
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

NoticeSender.prototype.prepareNotice = function(hash, host, infringements) {
  var self = this
    , notice = {}
    ;
  notice._id = hash;
  notice.metadata = {
    to: host.noticeDetails.metadata.to
  };
  notice.host = host._id;
  notice.infringements = [];
  infringements.forEach(function(infringement) {
    notice.infringements.push(infringement._id);
  }); 
  return notice;
}

//
// Overrides
//
NoticeSender.prototype.getName = function() {
  return "noticesender";
}

NoticeSender.prototype.orderJobs = function(campaign, client){
  var self = this
    , noticeInfo = campaign.noticeInfo || {}
    ;

  if(!noticeInfo.authorization || !noticeInfo.copyrightContact){
    logger.info('Not going to create a noticesending job for ' + campaign.name + ', we dont have the goods.');
    return [];
  }
  return NoticeSender.super_.prototype.orderJobs.apply(this, arguments);
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

if (require.main === module) {

  var job = {
    "_id": {
      "owner": "cb63ca74af80ded78dd482594b0e8ed3d95b03d0",
      "role": "noticesender",
      "consumer": "noticesender",
      "created": 1384771491629
    },
    "finished": 0,
    "log": [],
    "metadata": {},
    "popped": 1384771493838,
    "priority": 0,
    "snapshot": {},
    "started": 0,
    "state": 0,
    "who": "WorldsEnd-77345"
  };

  var noticeSender = new NoticeSender();
  noticeSender.on('error', process.exit);
  noticeSender.on('finished', process.exit)
  noticeSender.processJob(null, job);
}