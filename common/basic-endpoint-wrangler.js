"use strict";
/*jslint white: true */
/*
 * basic-endpoint-wrangler.js - for a given web page can scrape out potential endpoints for given plugins
 *  - alternate version that does not run through selenium
 *  - the caveat being that although it is much quicker and 'safer', it will not find anything hidden behind javascript
 * (C) 2013 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , cheerio = require('cheerio')
  , EndpointWrangler = acquire('endpoint-wrangler')
  , events = require('events')
  , logger = acquire('logger').forFile('basic-endpoint-wrangler.js')
  , Promise = require('node-promise').Promise
  , all = require('node-promise').all
  , request = require('request')
  , seq = require('node-promise').seq
  , shouldIgnoreUri = acquire('iframe-exploder').shouldIgnoreUri
  , URI = require('URIjs')
  , util = require('util')
  , when = require('node-promise').when
  , XRegExp = require('xregexp').XRegExp
;

var MAX_DEPTH = 7; // don't go more than 7 iframes deep, that is reta.. bad. 
var USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

var Wrangler = module.exports.Wrangler = function () {
  var self = this;
  events.EventEmitter.call(self);
  self.foundItems = [];
  self.modules = [];
  self.isRunning = false;
  
};
util.inherits(Wrangler, EndpointWrangler.Wrangler);

Wrangler.prototype.beginSearch = function (uri) {
  var self = this;

  if (self.isRunning) { throw new Error('tried to begin new search whilst still processing a previous search'); }
  self.isRunning = true;
  self.processing = 0; // a counter that counts the number of processing items
  self.foundURIs = [];
  
  self.uri = uri;
  self.processUri(uri, []).then(function onFinishedProcessing() {
    self.isRunning = false;

    if (self.processing < 1) {
      // we only emit this signal if we are done processing all items.
      self.emit('finished', self.foundItems);
    }
  });

  self.busyCount = process.hrtime();
  self.isSuspended = false;
  self.busyCheckTimer = self.doBusyCheck.bind(self).delay(5000, self.busyCount);
  self.on('finished', function () { self.busyCheckTimer.cancel(); });
};

// does a check every 5 seconds to see if we are actually doing anything.
// sometimes websites take a long time to respond.
Wrangler.prototype.doBusyCheck = function (lastCheckCount) {
  var self = this;
  function hrLessThan(left, right) { return (left[0] < right[0] || (left[0] === right[0] && left[1] < right[1])); }
  function hrEquals(left, right) { return (left[0] === right[0] && left[1] === right[1]); }

  if (self.isSuspended && hrLessThan(self.busyCount, lastCheckCount)) {
    self.isSuspended = false;
    self.emit('resumed');
  }
  if (!self.isSuspended && hrEquals(self.busyCount, lastCheckCount)) {
    self.isSuspended = true;
    self.emit('suspended');
  }

  if (self.isSuspended && process.hrtime(self.busyCount)[0] > 30) {
    logger.info('(%s) suspended for %d seconds...', self.uri, process.hrtime(self.busyCount)[0]);
  }

  self.busyCheckTimer = self.doBusyCheck.bind(self).delay(5000, self.busyCount);
};

Wrangler.prototype.findIFrames = function ($) {
  return $('iframe').map(function () { return $(this).attr('src'); });
};

Wrangler.prototype.processIFrames = function (uri, parents, $) {
  var self = this;
  var promise = new Promise();
  var composedURI = '';

  if (parents.length >= MAX_DEPTH) { 
    promise.reject(new Error('iframe MAX_DEPTH (' + MAX_DEPTH + ') reached'), true);
    return promise; 
  }

  // build an array of promises from the iframes array
  var newIFrames = self.findIFrames($).map(function foundIFrame(iframeSrc) {
    try {
      composedURI = URI(iframeSrc).absoluteTo(uri).toString();
    } catch (error) {
      return null; // probably 'javascript;'
    }

    if (shouldIgnoreUri(composedURI)) { return null; }
    if (self.foundURIs.some(composedURI)) { return null; }

    return self.processUri(composedURI, parents);
  }).compact();

  all(newIFrames).then(function () {
    promise.resolve();
  });

  return promise;
};

Wrangler.prototype.processUri = function (uri, parents) {
  var promise = new Promise();
  var self = this;
  self.foundURIs.push(uri);

  var reqOpts = {
    'uri': uri, 
    'headers': { 'Referer': parents.last() },
    'User-Agent': USER_AGENT, 
    'timeout':30*1000 
  };

  // we do all this in a callback to process.nextTick
  // so that we return to nodes event loop, just means we should be more efficient
  // with reguards to distributing resources between cpu and io
  process.nextTick(function doInNextTick() {
    var reqPromise = new Promise();
    var reqObj = request(reqOpts, function (error, response, body) { 
      self.busyCount = process.hrtime(); // bump the busy counter
      if (!!error) { reqPromise.reject(error, response); }
      else if (response.statusCode >= 200 && response.statusCode < 300) { reqPromise.resolve(body); }
    });

    // create a timeout, sometimes request doesn't seem to timeout appropriately. 
    var timeoutRequest = function() {
      reqObj.abort();
      reqPromise.reject(new Error('Timeout reached'));
    };
    var delayedTimeoutRequest = timeoutRequest.delay(40 * 1000);

    reqPromise.then(function (body) {
      delayedTimeoutRequest.cancel();
      var $ = cheerio.load(body);
      self.processSource(uri, parents, $, body);

      var newParents = parents.clone();
      newParents.push(uri);
      self.processIFrames(uri, newParents, $).then(function () { promise.resolve(); });
    }, function onRequestError(error, response) {
      delayedTimeoutRequest.cancel();
      var statusCode = (!!response) ? response.statusCode : 0;
      logger.info('%s - Error(%d): %s', uri, statusCode, error);
      promise.reject(new Error('(' + uri + ') request failed: ' + error), true);
    });

  });

  return promise;
};

Wrangler.prototype.quit = function () {
  var self = this;
};

Wrangler.prototype.setupIFrameHandler = function () { }; // does nothing, just want to zero it out.