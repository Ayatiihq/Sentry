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
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , Links = acquire('links')
  , Role = acquire('role')
  , Settings = acquire('settings')
  ;

var Miner = module.exports = function() {
  this.campaigns_ = null;
  this.infringements_ = null;
  this.links_ = null;
  this.settings_ = null;

  this.started_ = false;
  this.poll = 0;

  this.init();
}

util.inherits(Miner, Role);

Miner.prototype.init = function() {
  var self = this;

  this.campaigns_ = new Campaigns();
  this.infringements_ = new Infringements();
  this.links_ = new Links();
  this.settings_ = new Settings('role.miner');
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
      });
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
  var self = this;

  links.forEach(function(link) {
    if (self.linkMatchesCampaign(link, campaign)) {
      self.infringements_.add(campaign, link.uri, link.type, link.source, link.metadata);
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
  // Use the info in link and campaign to see if the link matches the campaign
  console.log(link, campaign);

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
  
  self.poll_ = setInterval(self.mine.bind(self),
                          config.MINER_CHECK_INTERVAL_MINUTES * 60 * 1000);
  self.mine();

  self.emit('started');
}

Miner.prototype.end = function() {
  var self = this;

  self.started_ = false;
  if (self.poll_) {
    clearInterval(self.poll_);
    self.poll_ = 0;
  }

  self.emit('ended');
}