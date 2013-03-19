/*
 * quartermaster.js: the quartermaster
 *
 * (C) 2012 Ayatii Limited
 *
 * QuarterMaster is the main producer of work for the rest of the system. It
 * 
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('quartermaster.js')
  , util = require('util')
  ;

var MinerDispatcher = require('./miner-dispatcher')
  , ScraperDispatcher = require('./scraper-dispatcher')
  , SpiderDispatcher = require('./spider-dispatcher')
  ;

var QuarterMaster = module.exports = function() {
  this.minerDispatcher_ = null;
  this.scraperDispatcher_ = null;
  this.spiderDispatcher_ = null;

  this.init();
}

QuarterMaster.prototype.init = function() {
  var self = this;

  if (config.HUB_NO_TASKS)
    return;

  self.minerDispatcher_ = new MinerDispatcher();
  self.scraperDispatcher_ = new ScraperDispatcher();
  self.spiderDispatcher_ = new SpiderDispatcher();
}