/*
 * index.js: the scraper role
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper is the general link scraping role.
 *
 */

var config = require('../../config')
  , events = require('events')
  , logger = require('../../logger').forFile('index.js')
  , mq = require('ironmq')(config.IRONMQ_TOKEN)(config.IRONMQ_PROJECT)  
  , util = require('util')
  ;

var Role = require('../role');

var Scraper = module.exports = function() {
  this.q_ = mq.queues(config.SCRAPER_QUEUE);
  this.pq_ = mq.queues(config.SCRAPER_QUEUE_PRIORITY);

  this.init();
}

util.inherits(Scraper, Role);

Scraper.prototype.init = function() {
  var self = this;

  self.q_.get(function(err, msgs) {
    if (err) {
      logger.warn(err);
      return;
    }
    msgs.forEach(function(msg) {
      console.log(msg);
      
      self.q_.del(msg.id, function(err, obj) {
        if (err)
          logger.warn(err);
      });
    });
  });

  logger.info('Scraper up and running');
}

//
// Overrides
//
Scraper.prototype.getName = function() {
  return "scraperRole";
}

Scraper.prototype.getDisplayName = function() {
  return "Scraper Role";
}

Scraper.prototype.start = function() {
  var self = this;
  self.emit('started');
}

Scraper.prototype.end = function() {
  var self = this;
  self.emit('ended');
}