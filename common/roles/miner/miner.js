/*
 * miner.js: the miner
 *
 * (C) 2012 Ayatii Limited
 *
 * Miner processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('miner.js')
  , Seq = require('seq')
  , states = acquire('states')
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Jobs = acquire('jobs')
  , Links = acquire('links')
  , Role = acquire('role')
  , Settings = acquire('settings')
  ;

var MAX_LINKS = 1000;

var Miner = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.links_ = null;
  this.settings_ = null;
  this.jobs_ = null;

  this.started_ = false;

  this.touchId_ = 0;
  this.lastTimestamp_ = 0;

  Role.call(this);
  this.init();
}

util.inherits(Miner, Role);

Miner.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.links_ = new Links();
  self.settings_ = new Settings('role.miner');
  self.jobs_ = new Jobs('miner');
}

Miner.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack);
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);

  self.campaigns_.getDetails(job._id.owner, function(err, campaign) {
    if (err) {
      self.emit('error', err);
      return;
    }
    self.mine(campaign, job);
  });
}

Miner.prototype.getCampaignKey = function(campaign) {
  return util.format('%s.%s.%s', campaign.name, campaign.created, 'timestamp');
}

Miner.prototype.mine = function(campaign, job) {
  var self = this
    , key = self.getCampaignKey(campaign)
    ;

  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, 
  config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  Seq()
    .seq('Get last mine timestamp', function() {
      var that = this;
      self.settings_.get(key, function(err, value) {
        if (err) console.warn(err);
        
        if (!value)
          value = 0;

        that(null, value);
      });
    })
    .seq('Empty available links', function(from) {
      self.processAllLinks(campaign, from, this);
    })
    .seq('Finish up', function(timestamp){
      logger.info('Finishing up mining for campaign %j', campaign._id);
      self.settings_.set(key, timestamp);
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to mine links for %j: %s', campaign._id, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Miner.prototype.processAllLinks = function(campaign, from, done) {
  var self = this;

  logger.info('Mining links for %j from timestamp %s', campaign._id, from);

  if (!self.started_)
    return done();

  self.links_.getLinks(campaign.type, Date.create(from), MAX_LINKS, function(err, links) {
    if (err || links.length == 0)
      return done(err, self.lastTimestamp_);

    self.matchLinks(campaign, links, function(err, timestamp) {
      self.lastTimestamp_ = timestamp;
      
      if (err)
        return done(err, self.lastTimestamp_);

      // Try to get more links to processs
      self.processAllLinks(campaign, from, done);
    });
  });
}

Miner.prototype.matchLinks = function(campaign, links, done) {
  var self = this;

  Seq(links)
    .seqEach(function(link) {
      if (self.linkMatchesCampaign(link, campaign)) {
        self.addLink(campaign, link, this);
      }
      else
        this();
    })
    .seq('done', function() {
      var last = links.last();
      if (last && last.created)
        done(null, last.created);
      else
        done(null, 0)
    })
    .catch(done)
    ;
}

Miner.prototype.linkMatchesCampaign = function(link, campaign) {
  var self = this;
  if (campaign.type === link.type){
    var patt=/\sLive|[^\w]/;
    var shortenedCampaignName = campaign.name.replace(patt, "").toLowerCase();
    var shortenedLinkName = link.channel.replace(patt, "").toLowerCase();
    if(shortenedCampaignName === shortenedLinkName){
      logger.info('we have match with campaign and link : ' + shortenedCampaignName + ' and ' + shortenedLinkName);
      return true;
    }
  }

  return false;
}

Miner.prototype.addLink = function(campaign, link, done) {
  var self = this
    , state = states.infringements.state.UNVERIFIED
    ;

  self.infringements_.add(campaign,
                          link.uri,
                          link.source,
                          state,
                          { score: 10, source: link.source, message: 'mined' },
                          link.metadata,
                          function(err) {
    if (err) {
      logger.warn(err);
      done();
    }
    else if (link.parent.length) {
      self.infringements_.addRelation(campaign, link.parent, link.uri, function() {
        done();
      });
    } else {
      done();
    }
  });
}

Miner.prototype.getTimestampKey = function(campaign) {
  return util.format('%s%s%s', campaign.type, campaign.name, 'timestamp');
}

//
// Overrides
//
Miner.prototype.getName = function() {
  return "miner";
}

Miner.prototype.start = function() {
  var self = this;

  self.started_ = true;
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Miner.prototype.end = function() {
  var self = this;

  self.started_ = false;
}