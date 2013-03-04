"use strict";
/*jslint white: true */
/*
 * basic-endpoint-wrangler.js - for a given web page can scrape out potential endpoints for given plugins
 *  - alternate version that does not run through selenium
 * (C) 2012 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , all = require('node-promise').all
  , cheerio = require('cheerio')
  , EndpointWrangler = acquire('endpoint-wrangler')
  , events = require('events')
  , logger = acquire('logger').forFile('basic-endpoint-wrangler.js')
  , Promise = require('node-promise').Promise
  , request = require('request')
  , util = require('util')
  , when = require('node-promise').when
  , XRegExp = require('xregexp').XRegExp
;

var BasicWrangler = function () {
  var self = this;
  events.EventEmitter.call(self);
  self.foundItems = [];
  self.modules = [];
  self.isRunning = false;
};
util.inherits(BasicWrangler, EndpointWrangler.Wrangler);

Wrangler.prototype.beginSearch = function (uri) {
  var self = this;
  if (self.isRunning) { throw new Error('tried to begin new search whilst still processing a previous search'); }
  self.isRunning = true;
  self.processing = 0; // a counter that counts the number of processing items

  self.uri = uri;
  self.processUri(uri, []).then(function onFinishedProcessing() {
    self.isRunning = false;
    if (self.processing < 1) {
      // we only emit this signal if we are done processing all items.
      self.emit('finished', self.foundItems);
    }
  });
};

Wrangler.prototype.findIframes = function ($) {
  return $('iframe').map(function () { return $(this).attr('src'); });
};

Wrangler.prototype.processUri = function (uri, parents) {
  var promise = new Promise();

  request({
    'uri': uri,
    'referer': parents.last()
  },
  function (error, response, body) {
    if (!error && response.statusCode === 200) {
      var $ = cheerio.load(body)
      self.processSource(uri, parents, $, body);
      var newParents = parents.clone();
      newParents.push(uri);

      var newIFrames = findIFrames($).map(function (iframeSrc) {
        return processUri.bind(iframeSrc, newParents);
      });

      all(newIFrames).then(function () {
        promise.resolve();
      });
    }
    else {
      promise.resolve();
    }
  });

  return promise;
};

Wrangler.prototype.quit = function () {
  var self = this;
};

Wrangler.prototype.setupIFrameHandler = function () { }; // does nothing, just want to zero it out.