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
  , events = require('events')
  , IFrameExploder = acquire('iframe-exploder')
  , logger = acquire('logger').forFile('endpoint-wrangler.js')
  , Promise = require('node-promise').Promise
  , request = require('request')
  , util = require('util')
  , webdriver = require('selenium-webdriverjs')
  , when = require('node-promise').when
  , XRegExp = require('xregexp').XRegExp
;

var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };
var urlmatch = XRegExp( //ignore jslint
  '(?<fulluri>' +
  '(?<protocol>(?:[a-z0-9]+)                                                               (?#protocol        )' + 
  '(?:://|%3A%2F%2F))                                                                      (?#:// no capture  )' +
  '(?:                                                                                     (?#captures domain )' +
  '(?:(?<subdomain>[a-z0-9-]+\\.)*(?<domain>[a-z0-9-]+\\.(?:[a-z]+))(?<port>:[0-9]+)?)     (?#subdomain+domain)' +
  '|' + 
  '(?<ip>[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}))                               (?#or ip           )' + 
  '(?<path>(?:/|%2F)[-a-z0-9+&@#/%=~_\\(\\)|]*(?<extension>\\.[-a-z0-9]+)?)*               (?#full path       )' + 
  '(?<paramaters>(?:\\?|%3F)[-a-z0-9+&@#/%=~_\\(\\)|]*)?                                   (?#paramaters      )' +
  ')',
  'gix'); // global, ignore case, free spacing 

/* - Scraper snippets, these are passed into the wrangler and executed on each html source it finds - */
module.exports.scraperEmbed = function DomEmbed($, source, foundItems) {
  $('embed').each(function onEmd() {
    var check = false;
    var sanitized = $(this).toString().toLowerCase();
    check |= sanitized.has('stream');
    check |= sanitized.has('streem');
    check |= sanitized.has('jwplayer');
    check |= sanitized.has('Live');

    if (check) { foundItems.push(this); }
  });
  return foundItems;
}; 

module.exports.scraperObject = function DomObject($, source, foundItems) {
  $('object').each(function onObj() {
    var check = false;
    var sanitized = $(this).toString().toLowerCase();
    check |= sanitized.has('stream');
    check |= sanitized.has('streem');
    check |= sanitized.has('jwplayer');
    check |= sanitized.has('Live');

    if (check) { foundItems.push(this); }
  });
  return foundItems;
}; 

/* A more complicated scraper, this one needs to be async so instead of returning an array
   it returns a promise and resolves that promise asyncronously
*/
module.exports.scraperRegexStreamUri = function RegexStreamUri($, source, foundItems) {
  var protocols = ['rtmp://', 'rtsp://', 'rttp://', 'rtmpe://'];
  var extensions = ['.flv', '.mp4', '.m4v', '.mov', '.asf', '.rm', '.wmv', '.rmvb',
                    '.f4v', '.mkv'];

  XRegExp.forEach(source, urlmatch, function (match, i) {
    // we can extract lots of information from our regexp
    var check = false;
    check |= protocols.some(match.protocol.toLowerCase());
    if (!!match.extension) { check |= extensions.some(match.extension.toLowerCase()); }
    if (check) {
      foundItems.push(match.fulluri);
    }
    
  });

  
  // function that for a given uri will simply open it and parse it for extensions and protocols. 
  // in addition it works through promises, it will return a promise that will be resolved after 
  // the uri is scraped.
  function xmlScraper(uri) {
    var xmlPromise = new Promise();
    var matches = [];

    request(uri, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        XRegExp.forEach(body, urlmatch, function (match, i) {
          var check = false;
          check |= protocols.some(match.protocol.toLowerCase());
          if (!!match.extension) { check |= extensions.some(match.extension.toLowerCase()); }
          if (check) {
            matches.push(match.fulluri);
          }
        });
      }
      xmlPromise.resolve(matches);
    });
    return xmlPromise;
  }

  var xmlscrapes = [];
  $('param').each(function onFlashVars() {
    XRegExp.forEach($(this).toString(), urlmatch, function (match, i) {
      if (match.fulluri.toLowerCase().has('xml')) {
        xmlscrapes.push(xmlScraper(match.fulluri));
      }
    });
  });

  if (xmlscrapes.length) {
    var promise = new Promise();
    
    // we use all() to wait for all the promises to resolve then resolve our own promise
    all(xmlscrapes).then(function onXMLScrapesFinish(scrapedURIs) {
      // scrapedURIs is an array of arrays of uris
      scrapedURIs.each(function (list) { foundItems = foundItems.union(list); });
      promise.resolve(foundItems);
    });

    return promise;
  }
  else {
    // if we don't have any xml to scrape, we can simply return now and become sync.
    return foundItems;
  }
}; 

/* - Collections, we create collections of scrapers here just to make the scraper/spider codebases less verbose - */
module.exports.scrapersLiveTV = [ module.exports.scraperEmbed
                                , module.exports.scraperObject
                                , module.exports.scraperRegexStreamUri];


var Wrangler = module.exports.Wrangler = function (driver) {
  var self = this;
  events.EventEmitter.call(this);
  this.driver = (!!driver) ? driver : new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                                                                           .withCapabilities(CAPABILITIES)
                                                                           .build();
  this.foundItems = [];

  this.modules = [];
  this.isRunning = false;
};
util.inherits(Wrangler, events.EventEmitter);


Wrangler.prototype.addScraper = function (scraper) {
  var self = this;
  if (Object.isArray(scraper)) {
    self.modules = self.modules.union(scraper);
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

Wrangler.prototype.clearScrapers = function () {
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

  self.iframe.on('found-source', function foundSource(uri, parenturls, $, source) {
    self.processing++;

    var pagemods = self.modules.map(function (scraper) { return scraper.bind(null, $, source); });
    var previousReturn = [];
    pagemods.each(function (scraper) {
      previousReturn = when(previousReturn, scraper);
    });

    if (Object.isArray(previousReturn)) {
      // no promises were returned by our scrapers so we can act right now
      self.constructItemsObject(previousReturn, uri, parenturls);
    }
    else {
      // we got a promise somewhere along the way, converting all subsequent calls to when
      // into returning promises so we need to wait for the promise chain to resolve.
      previousReturn.then(function onPromiseResolve(items) {
        self.constructItemsObject(items, uri, parenturls);
      });
    }
  });

  // call to start the whole process
  self.iframe.search();
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