/*
 * scraper-dispatcher.js: the scraper-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches Scraper jobs for campaigns
 *
 */

var events = require('events')
  , logger = require('../../logger').forFile('scraper-dispatcher.js')
  , util = require('util')
  ;

var Scrapers = require('../scrapers');

var qActiveCampaigns = " \
  SELECT name, sweepintervalminutes, type, scrapersenabled, scrapersignored \
  FROM campaigns \
  WHERE sweepenabled \
  AND sweepfromdate < current_timestamp \
  AND sweeptodate > current_timestamp \
;";

var ScraperDispatcher = module.exports = function(postgres) {
  this.postgres_ = postgres;
  this.scrapers_;

  this.init();
}

util.inherits(ScraperDispatcher, events.EventEmitter);

ScraperDispatcher.prototype.init = function() {
  var self = this;

  self.scrapers_ = new Scrapers();
  if (self.scrapers_.isReady()) {
    self.start();
  } else {
    self.scrapers_.on('ready', self.start.bind(self));
  }

  logger.info('Running');
}

ScraperDispatcher.prototype.start = function() {
  var self = this;

  // Do a basic check on campaigns on an interval
  setInterval(self.iterateCampaigns.bind(self), config.GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES);

  // Kick off the first one
  self.start();
}

ScraperDispatcher.prototype.iterateCampaigns = function() {
  var self = this;

  var query = self.postgres_.query(qActiveCampaigns);
  query.on('row', function(row) {
    self.checkCampaign(row);
  });
  query.on('error', console.log);
}

ScraperDispatcher.prototype.checkCampaign = function(campaign) {
  var self = this;

  

  logger.info(campaign);
}