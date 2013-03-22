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
  , Links = acquire('links')
  , Role = acquire('role')
  , Settings = acquire('settings')
  , Queue = acquire('queue')
  ;

var MAX_QUEUE_POLLS = 1
  , QUEUE_CHECK_INTERVAL = 1000 * 10
  ;

var Miner = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.links_ = null;
  this.settings_ = null;
  this.queue_ = null;
  this.priorityQueue_ = null;

  this.started_ = false;
  this.poll = 0;
  this.queuePolls_ = 0;

  this.init();
}

util.inherits(Miner, Role);

Miner.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.infringements_ = new Infringements();
  self.links_ = new Links();
  self.settings_ = new Settings('role.miner');
  self.queue_ = new Queue('miner');
  self.priorityQueue_ = new Queue('miner-priority');
}

Miner.prototype.findJobs = function() {
  var self = this;

  if (self.poll)
    return;

  self.poll = setTimeout(self.checkAvailableJob.bind(self), QUEUE_CHECK_INTERVAL);
  logger.info('Job search enqueued');
}

Miner.prototype.checkAvailableJob = function() {
  var self = this;

  if (self.queuePolls_ >= MAX_QUEUE_POLLS)
    return self.emit('finished');

  self.queuePolls_ += 1;

  self.poll = 0;

  logger.info('Checking priority queue');
  self.priorityQueue_.pop(function(err, message) {
    if (err || !message) {
      if (err)
        logger.warn('Unable to check priority queue: ' + err);

      logger.info('Checking default queue');
      self.queue_.pop(config.MINER_JOB_TIMEOUT_SECONDS, function(err, message) {
        if (err) {
          logger.warn(err);
          self.findJobs();
        } else if (!message) {
          self.findJobs();
        } else {
          self.processJobs(self.queue_, [message]);
        }
      });
    } else {
      self.processJobs(self.priorityQueue_, [message]);
    }
  });
}

Miner.prototype.processJobs = function(queue, jobs) {
  var self = this;

  jobs.forEach(function(job) {
    logger.info('Processing ' + JSON.stringify(job));
    queue.delete(job, console.log);
  });

  self.mine();
}

Miner.prototype.mine = function() {
  var self = this
    , cache = {}
    ;

  self.campaigns_.listActiveCampaigns(function(err, campaigns) {
    if (err) {
      logger.warn('Unable to get list of campaigns: ' + err);
      return;
    }

    // To avoid hammering the CPU, we seq() the workload
    Seq(campaigns)
      .seqEach(function(campaign) {
        var done = this
           , key = self.getTimestampKey(campaign)
           ;

        self.settings_.get(key, function(err, from) {
          if (err || from === undefined) {
            logger.warn('Couldn\'t get value ' + key + ':' + err);
            from = '0';
          }
          from = parseInt(from);

          logger.info(util.format('Search for campaign %s from timestamp %s',
                      campaign.name, from));

          // Get us some links
          var cacheKey = campaign.type + from.toString();
          var links = cache[cacheKey];
          if (links) {
            self.mineCampaign(campaign, links, done);
            self.updateTimestamp(key, campaign, links);
            self.findJobs();
          
          } else {
            self.links_.getLinks(campaign.type, Date.create(from), function(err, links) {
              if (err) {
                logger.warn('Couldn\'t get links for ' + campaign.type + ':' + err);
                links = [];
              } else {
                links = links;
                cache[cacheKey] = links;
              }

              self.mineCampaign(campaign, links, done);
              self.updateTimestamp(key, campaign, links);
            });
          }
        });
      })
      .seq(function() {
        self.findJobs();
      })
      ;
  });
}

Miner.prototype.updateTimestamp = function(key, campaign, links) {
  var self = this;

  logger.info(util.format('Found %s new links for campaign %s',
              links.length, campaign.name));

  if (links) {
    var lastLink = links[links.length - 1];
    if (lastLink && lastLink.created) {
      self.settings_.set(key, lastLink.created);
    }
  }
}

Miner.prototype.mineCampaign = function(campaign, links, done) {
  var self = this
    , state = states.infringements.state.UNVERIFIED
    ;

  links.forEach(function(link) {
    if (self.linkMatchesCampaign(link, campaign)) {
      self.infringements_.add (campaign,
                               link.uri, link.type, link.source, state,
                               {score: 10, source: link.source, message: 'mined from the source'},
                               link.metadata);
      if (link.parent.length > 0)
        self.infringements_.addRelation(campaign, link.parent, link.uri);
    }
  });
  done();
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

  return false; // for now
}

Miner.prototype.getTimestampKey = function(campaign) {
  return util.format('%s.%s.%s', campaign.type, campaign.name, 'timestamp');
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
  self.findJobs();

  self.emit('started');
}

Miner.prototype.end = function() {
  var self = this;

  self.started_ = false;
  if (self.poll) {
    clearInterval(self.poll);
    self.poll = 0;
  }

  self.emit('ended');
}