"use strict";
/*
 * endpoint-wrangler.js - for a given web page can scrape out potential endpoints for given plugins
 *
 * (C) 2012 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('endpoint-wrangler.js')
  , util = require('util')
  , webdriver = require('selenium-webdriverjs')
  , URI = require('URIjs')
  , cheerio = require('cheerio')
  , IFrameExploder = acquire('iframe-exploder')
  , XRegExp = require('xregexp').XRegExp
;

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' };
var urlmatch = XRegExp(
  '(?<protocol>(?:[a-z0-9]+)                                                               (?#protocol        )' +
  '(?:://|%3A%2F%2F))                                                                      (?#:// no capture  )' +
  '(?:                                                                                     (?#captures domain )' +
  '(?:(?<subdomain>[a-z0-9-]+\\.)*(?<domain>[a-z0-9-]+\\.(?:[a-z]+))(?<port>:[0-9]+)?)     (?#subdomain+domain)' +
  '|' +
  '(?<ip>[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}))                               (?#or ip           )' +
  '(?<path>(?:/|%2F)[-a-z0-9+&@#/%=~_\\(\\)|]*(?<extension>\\.[-a-z0-9]+)?)*               (?#full path       )' +
  '(?<paramaters>(?:\\?|%3F)[-a-z0-9+&@#/%=~_\\(\\)|]*)?                                   (?#paramaters      )',
  'gix'); // global, ignore case, free spacing 

/* - Scraper snippets, these are passed into the wrangler and executed on each html source it finds - */
module.exports.scraperEmbed = function DomEmbed($, source) {
  var foundItems = [];
  $('embed').each(function onEmd() { foundItems.push(this); });
  return foundItems;
}; 

module.exports.scraperObject = function DomObject($, source) {
  var foundItems = [];
  $('object').each(function onObj() { foundItems.push(this); });
  return foundItems;
}; 

module.exports.scraperRegexStreamUri = function RegexStreamUri($, source) {
  var foundItems = [];
  var protocols = ['rtmp', 'rtsp', 'rttp'];
  var extensions = ['.flv', '.mp4', '.m4v', '.mov', '.asf', '.rm', '.wmv', '.rmvb',
                    '.f4v', '.mkv'];

  XRegExp.forEach(source, urlmatch, function (match, i) {
    // we can extract lots of information from our regexp
    var check = false;
    check |= protocols.some(match.protocol.toLowerCase());
    if (!!match.extension) { check |= extensions.some(match.extension.toLowerCase()); }

    if (check) {
      foundItems.push(match);
    }
  });

  // FIXME - we should do more here, check for flashvars with XML based uris contained within,
  //         then scrape said XML files for stream uris
  return foundItems;
}; 

/* - Collections, we create collections of scrapers here just to make the scraper/spider codebases less verbose - */
module.exports.scrapersLiveTV = [module.exports.scraperEmbed,
                                 module.exports.scraperObject,
                                 module.exports.scraperRegexStreamUri];


var Wrangler = module.exports.Wrangler = function (driver) {
  var self = this;
  events.EventEmitter.call(this);
  if (!!driver) { this.driver = driver; }
  this.driver = (!!driver) ? driver : self.client = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                                                                           .withCapabilities(CAPABILITIES)
                                                                           .build();
  this.foundItems = [];

  this.modules = [];
  this.isRunning = false;
}; util.inherits(Wrangler, events.EventEmitter);


Wrangler.prototype.addScraper = function (scraper) {
  var self = this;
  if (Object.isArray(scraper)) {
    self.modules = self.modules.union(scraper);
  }
  else {
    if (!self.modules.some(function (stored_module) { return (module === stored_module); })) {
      self.modules.push(module);
    }
    else {
      throw new Error('Yo homes?! this module already be in the list.. brudda?', module);
    }
  }
};

Wrangler.prototype.clearScrapers = function () {
  var self = this;
  self.modules = [];
};

Wrangler.prototype.beginSearch = function(uri) {
  var self = this;
  if (self.isRunning) { throw new Error('tried to begin new search whilst still processing a previous search'); }

  self.uri = uri;
  this.driver.get(uri).then(function() {
    self.setupIFrameHandler();
  });
};

Wrangler.prototype.setupIFrameHandler = function () {
  var self = this;
  self.iframe = new IFrameExploder(self.client);
  self.iframe.debug = true; // don't do this in production, too noisy

  self.iframe.on('finished', function iframeFinished() { // when we are finished it's safe to use self.client again
    self.iframe = null;
    self.isRunning = false;
    self.emit('finished', self.foundItems);
    self.url = null;
  });

  self.iframe.on('found-source', function foundSource(uri, parenturls, $, source) {
    self.modules.each(function (scraper) {
      var objlist = scraper($, source);
      
      objlist.each(function (obj) {
        var newitem = {
          'uri': uri,
          'parents': parenturls,
          'scraper': scraper.name,
          'item': obj
        };
        self.foundItems.push(newitem);
        self.emit('found-item', newitem);
      });

    });
  });

  // call to start the whole process
  self.iframe.search();
};