"use strict";
/*
 * iframe-exploder.js - explodes iframes into lots of html source events
 *
 * (C) 2012 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('iframe-exploder.js')
  , util = require('util')
  , webdriver = require('selenium-webdriverjs')
  , URI = require('URIjs')
  , cheerio = require('cheerio')
  , XRegExp = require('xregexp').XRegExp
;


function shouldIgnoreUri(uri) {
  var ignoreUris = [
    XRegExp('facebook')   // like button
   ,XRegExp('google')     // +1
   ,XRegExp('twitter')    // tweet
   ,XRegExp('://ad\.')    // common ad subdomain
   ,XRegExp('/ads[0-9]*(\.|/)') // foo.com/ads1.php or foo.com/ads/whateverelse
  ];

  return ignoreUris.some(function ignoreTest(testregex) {
    return testregex.test(uri);
  });

};

// iframe object for containing which iframes we have looked at.
// children should be an array of other iframe objects
var IFrameObj = module.exports = function (client, element, urlmap, depth, root, parent) {
  var self = this;
  events.EventEmitter.call(this);
  this.debug = false;
  this.depth = (depth === undefined) ? 0 : depth;
  this.root = (root) ? root : this;
  this.parent = (parent) ? parent : null;
  this.isExempt = false;

  this.element = (element === undefined) ? null : element;
  this.client = client;
  this.children = [];

  /* cache */
  this.source = null;
  this.$ = null;

  this.urlmap = (urlmap === undefined) ? [] : urlmap;
  this.state = 'unseen';
  if (this.element !== null) {
    self.src = URI(self.element.attr('src')).absoluteTo(this.parent.src).toString().trim();
  }
  else {
    self.client.getCurrentUrl().then(function (url) { self.src = url.trim(); });
  }
};

util.inherits(IFrameObj, events.EventEmitter);

IFrameObj.prototype.getParentURIs = function () {
  var self = this;
  var parent = self.parent;
  var parentlist = [];
  while (parent !== null) {
    parentlist.push(parent.src);
    parent = parent.parent;
  };

  return parentlist;
};

IFrameObj.prototype.getSource = function (callback) {
  var self = this;
  if (this.source !== null) { if (callback) { callback(self.$, self.source); } }
  else {
    self.client.getPageSource().then(function getSource(source) {
      self.source = source;
      self.$ = cheerio.load(source);
      if (callback) { callback(self.$, self.source); };
    }, self.root.emit.bind(self.root, 'error'));
  }
};

IFrameObj.prototype.emitSource = function () {
  var self = this;
  self.root.emit('found-source', self.src, self.getParentURIs(), self.$, self.source);
};

IFrameObj.prototype.buildFrameMap = function () {
  var self = this;
  var $ = self.$;

  $('iframe').each(function () {
    var newObj = new IFrameObj(self.client, this, self.urlmap, self.depth + 1, self.root, self);
    newObj.root = self.root;
    self.children.push(newObj);
  });
  self.state = 'seen';

  if (this.urlmap.count(self.src) < 1) { self.isExempt = true; }
  this.urlmap.push(self.src);
};

IFrameObj.prototype.selectNextFrame = function () {
  // selects the next frame that hasn't been seen before
  var self = this;
  var frameindex = this.children.findIndex(function findNextFrame(frame) {
    if (self.urlmap.some(frame.src) && frame.isExempt && frame.getState() === 'unseen') { return true; }
    else if (!self.urlmap.some(frame.src)
              && frame.getState() === 'unseen'
              && !shouldIgnoreUri(frame.src)) { return true; }
    else {
      return false;
    }

  });
  if (frameindex >= 0) {
    var frame = this.children[frameindex];
    if (self.root.debug) { logger.info('-'.repeat(self.depth + 1) + '> select iframe: ' + frame.src.truncate(40, true, 'middle')); }
    this.client.switchTo().frame(frameindex).then(function () { }, self.root.emit.bind(self.root, 'error'));
    frame.search();
  }
  else {
    self.selectDefault();
  }
};

IFrameObj.prototype.getState = function () {
  var self = this;
  // state is a combination of children states
  if (this.state === 'unseen') { return 'unseen'; };
  if (this.children.length < 1) { return 'endpoint'; } // we have no children, so we are an endpoint;

  var unseen_children = this.children.filter(function (child) {
    return (!self.urlmap.some(child.src)
            && child.getState() === 'unseen'
            && !shouldIgnoreUri(child.src));
  });

  if (!unseen_children.length) { return 'seen'; }
  return 'unseen';
};

IFrameObj.prototype.selectDefault = function () {
  var self = this;
  if (self.root.debug) { logger.info('<' + '-'.repeat(self.depth + 1) + ' select root frame'); }
  self.client.switchTo().defaultContent().then(function () { }, self.root.emit.bind(self.root, 'error')); // goes back to the "default" frame
  self.root.search();
};

IFrameObj.prototype.search = function () {
  var self = this;
  function selectFrameLogic() {
    if (self.getState() !== 'unseen' && self.root === self) {
      // we are root and have seen all our children
      self.emit('finished');
    }
    else if (self.getState() === 'endpoint') {
      if (self.root === self) { self.emit('finished'); }
      else {
        self.selectDefault();
      }
    }
    else {
      self.selectNextFrame();
    }
  };


  if (self.state !== 'seen' && !self.urlmap.some(self.src)) {
    // we have not seen this yet, so we need to build a framemap and all that 
    // gubbins
    self.getSource(function onPageSource() {
      self.emitSource();
      self.buildFrameMap();
      selectFrameLogic();
    });
  }
  else {
    selectFrameLogic();
  }
};
