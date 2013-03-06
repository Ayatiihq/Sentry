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
  , request = require('request')
  , seq = require('node-promise').seq
  , shouldIgnoreUri = acquire('iframe-exploder').shouldIgnoreUri
  , URI = require('URIjs')
  , util = require('util')
  , when = require('node-promise').when
  , XRegExp = require('xregexp').XRegExp
;

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

  self.uri = uri;
  self.processUri(uri, []).then(function onFinishedProcessing() {
    self.isRunning = false;
    if (self.processing < 1) {
      // we only emit this signal if we are done processing all items.
      self.emit('finished', self.foundItems);
    }
  });
};

Wrangler.prototype.findIFrames = function ($) {
  return $('iframe').map(function () { return $(this).attr('src'); });
};

Wrangler.prototype.processUri = function (uri, parents) {
  var promise = new Promise();
  var self = this;

  if (shouldIgnoreUri(uri)) {
    // ignore this uri
    return null;
  }


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

      var newIFrames = self.findIFrames($).map(function (iframeSrc) {
        var composedURI = URI(iframeSrc).absoluteTo(uri).toString();
        return self.processUri.bind(self, composedURI, newParents);
      });

      seq(newIFrames).then(function () {
        promise.resolve();
      });
    }
    else {
      logger.info(error);
      promise.resolve();
    }
  });

  return promise;
};

Wrangler.prototype.quit = function () {
  var self = this;
};

Wrangler.prototype.setupIFrameHandler = function () { }; // does nothing, just want to zero it out.