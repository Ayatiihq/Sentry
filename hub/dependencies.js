/*
 * dependencies.js: manages resource allocation on the system
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , cheerio = require('cheerio')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('dependencies.js')
  , request = require('request')
  , sugar = require('sugar')
  , util = require('util')
  , Cowmangler = acquire('cowmangler')  
  ;

var Seq = require('seq');

var SELENIUM_TABS_PER_NODE = 2;

var Dependencies = module.exports = function() {
  this.depMap_ = {};
  this.statusMap_ = {};

  this.seleniumLastCheck_ = new Date.create('1 hour ago');
  this.seleniumAvailableNodes_ = 0;
  this.seleniumBusyNodes_ = 0;

  this.manglerLastCheck_ = new Date.create('1 hour ago');
  this.manglerAvailableTabs_ = 0;
  this.manglerBusyTabs_ = 0;
  
  this.cowMangler = new Cowmangler();
  this.init();
}

util.inherits(Dependencies, events.EventEmitter);

Dependencies.prototype.init = function() {
  var self = this;

  self.depMap_['selenium'] = self.isSeleniumAvailable.bind(self);
  self.statusMap_['selenium'] = self.seleniumStatus.bind(self);
  self.depMap_['cowmangler'] = self.isManglerAvailable.bind(self);
  self.statusMap_['cowmangler'] = self.manglerStatus.bind(self);
}

Dependencies.prototype.isSeleniumAvailable = function(args, callback) {
  var self = this
    , required = args
    ;

  Seq()
    .seq('checkCached', function() {
      if (self.seleniumLastCheck_.isAfter('60 seconds ago')) {
        var available = (self.seleniumAvailableNodes_ - self.seleniumBusyNodes_) >= required;
        if (available)
          self.seleniumBusyNodes_ += 1;
        callback(null, available);
      } else {
        this();
      }
    })
    .seq('getHTML', function() {
      request(config.SELENIUM_CONSOLE_ADDRESS, this);
    })
    .seq('parseHTML', function(res, body) {
      var $ = cheerio.load(body);
      this(null, $('body').find(config.SELENIUM_CONSOLE_PROXY_CLASS).length, $('body').find(config.SELENIUM_CONSOLE_BUSY_CLASS).length);
    })
    .seq('updateCacheAndReturn', function(nAvailable, nBusy) {
      self.seleniumAvailableNodes_ = nAvailable * SELENIUM_TABS_PER_NODE;
      self.seleniumBusyNodes_ = nBusy;
      self.seleniumLastCheck_ = new Date();

      logger.info('Selenium status: %d total, %d busy', self.seleniumAvailableNodes_, self.seleniumBusyNodes_);

      // Now for the one we're about to do
      self.seleniumBusyNodes_ += 1;
      callback(null, (self.seleniumAvailableNodes_ - self.seleniumBusyNodes_) >= required);
    })
    .catch(function(err) {
      callback(err, false);
    })
    ;
}

Dependencies.prototype.seleniumStatus = function(callback) {
  var self = this
    , status = {}
    ;

  self.isSeleniumAvailable(1, function(err) {
    status.nNodes = self.seleniumAvailableNodes_;
    status.nBusyNodes = self.seleniumBusyNodes_;
    callback(err, status);
  });
}

Dependencies.prototype.isManglerAvailable = function(args, callback) {
  var self = this
    , required = args
    ;
  Seq()
    .seq('checkCached', function() {  
      if (self.manglerLastCheck_.isAfter('30 seconds ago')) {
        var available = self.manglerAvailableTabs_ >= required;
        if (available){
          self.manglerBusyTabs_ += required;
          self.manglerAvailableTabs_ -= required;
        }
        return callback(null, available);
      }
      this();
    })
    .seq('checkStatus', function() {  
      self.cowMangler.getStatus(this);
    })
    .seq('checkAvailableNodes', function(nodeStatus) {
      // reset
      self.manglerAvailableTabs_ = 0;
      self.manglerBusyTabs_ = 0;

      Object.keys(nodeStatus).each(function(node){
        self.manglerAvailableTabs_ += nodeStatus[node].max_tab_count - nodeStatus[node].tab_count;
        self.manglerBusyTabs_ += nodeStatus[node].tab_count;
      });

      self.manglerLastCheck_ = new Date();
      var available = self.manglerAvailableTabs_ >= required;
      
      if (available){
        self.manglerBusyTabs_ += required;
        self.manglerAvailableTabs_ -= required;
      }
      callback(null, available);
    })
    .catch(function(err) {
      callback(err, false);
    })
    ;    
}

// Do we need this ?
Dependencies.prototype.manglerStatus = function(callback) {
  var self = this
    , status = {}
    ;

  self.isManglerAvailable(1, function(err) {
    status.nNodes = self.manglerAvailableTabs_;
    status.nBusyNodes = self.manglerBusyTabs_;
    callback(err, status);
  });
}


//
// Public
//
Dependencies.prototype.isAvailable = function(dependency, args, callback) {
  var self = this;

  callback = callback ? callback : function() {};

  var func = self.depMap_[dependency];
  if (func)
    func(args, callback);
  else
    callback(null, true);
}

Dependencies.prototype.getStatus = function(dependency, callback) {
  var self = this;

  callback = callback ? callback : function() {};

  var func = self.statusMap_[dependency];
  if (func)
    func(callback);
  else
    callback(null, {});  
}