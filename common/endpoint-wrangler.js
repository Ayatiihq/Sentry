"use strict";
/*jslint white: true */
/*
 * endpoint-wrangler.js - for a given web page can scrape out potential endpoints for given plugins
 *
 * (C) 2012 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , all = require('node-promise').all
  , config = acquire('config')
  , events = require('events')
  , IFrameExploder = acquire('iframe-exploder')
  , logger = acquire('logger').forFile('endpoint-wrangler.js')
  , Promise = require('node-promise').Promise
  , request = require('request')
  , util = require('util')
  , webdriver = require('selenium-webdriver')
  , when = require('node-promise').when
  , XRegExp = require('xregexp').XRegExp
;

var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

/* - Actual wrangler code - */
var Wrangler = module.exports.Wrangler = function (driver) {
  var self = this;
  events.EventEmitter.call(this);
  if (!driver) {
    self.driver = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                               .withCapabilities(CAPABILITIES)
                               .build();
  }
  else {
    this.driver = driver;
  }

  this.foundItems = [];

  this.modules = [];
  this.isRunning = false;
};
util.inherits(Wrangler, events.EventEmitter);


Wrangler.prototype.addRule = function (rule) {
  var self = this;
  if (Object.isArray(rule)) {
    self.modules = self.modules.union(rule);
  }
  else {
    if (!self.modules.some(function (storedModule) { return (module === storedModule); })) {
      self.modules.push(module);
    }
    else {
      throw new Error('Yo homes?! this module already be in the list.. brudda?', module);
    }
  }
};

Wrangler.prototype.clearRules = function () {
  var self = this;
  self.modules = [];
};

Wrangler.prototype.beginSearch = function(uri) {
  var self = this;
  if (self.isRunning) { throw new Error('tried to begin new search whilst still processing a previous search'); }
  self.isRunning = true;

  self.uri = uri;
  this.driver.get(uri).then(function() {
    self.setupIFrameHandler();
  }, self.emit.bind(self, 'error'));
};

Wrangler.prototype.setupIFrameHandler = function () {
  var self = this;
  self.iframe = new IFrameExploder(self.driver);
  self.iframe.debug = true; // don't do this in production, too noisy
  self.processing = 0; // a counter that counts the number of processing items

  self.iframe.on('error', self.emit.bind(self, 'error'));

  self.iframe.on('finished', function iframeFinished() { // when we are finished it's safe to use self.client again
    self.iframe = null;
    self.isRunning = false;
    self.url = null;

    if (self.processing < 1) {
      // we only emit this signal if we are done processing all items.
      self.emit('finished', self.foundItems);
    }
  });

  self.iframe.on('found-source', self.processSource.bind(self));

  // call to start the whole process
  self.iframe.search();
};

Wrangler.prototype.processSource = function (uri, parenturls, $, source) {
  var self = this;
  self.processing++;

  var pagemods = self.modules.map(function (rule) { return rule.bind(null, $, source, uri); });

  var previousReturn = [];
  pagemods.each(function (rule) {
    previousReturn = when(previousReturn, rule);
  });

  if (Object.isArray(previousReturn)) {
    // no promises were returned by our rules so we can act right now
    self.constructItemsObject(previousReturn, uri, parenturls);
  }
  else {
    // we got a promise somewhere along the way, converting all subsequent calls to when
    // into returning promises so we need to wait for the promise chain to resolve.
    previousReturn.then(function onPromiseResolve(items) {
      self.constructItemsObject(items, uri, parenturls);
    });
  }
};

Wrangler.prototype.constructItemsObject = function (items, uri, parenturls) {
  var self = this;
  if (items.length) {
    self.foundItems.push({
      'uri': uri,
      'parents': parenturls,
      'items': items
    });
  }
  self.processing--;

  if (self.processing < 1 && !self.isRunning) {
    self.emit('finished', self.foundItems);
  }
};

Wrangler.prototype.quit = function () {
  var self = this;
  self.driver.quit();
};