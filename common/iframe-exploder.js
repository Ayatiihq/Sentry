﻿"use strict";
/*
 * newtvworld.js: a newtvworld spider
 *
 * (C) 2012 Ayatii Limited
 *
 * Spider.
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
;

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' };

// iframe object for containing which iframes we have looked at.
// children should be an array of other iframe objects
var IFrameObj = function (client, element, urlmap, depth, root) {
  var self = this;
  events.EventEmitter.call(this);
  this.depth = (depth === undefined) ? 0 : depth;
  this.root = (root) ? root : this;
  
  this.element = (element === undefined) ? null : element;
  this.client = client;
  this.children = [];

  /* cache */
  this.source = null;
  this.$ = null;

  this.urlmap = (urlmap === undefined) ? [] : urlmap;
  this.state = 'unseen';
  if (this.element !== null) {
    self.src = URI(self.element.attr('src')).absoluteTo(this.root.src).toString().trim();
  }
  else {
    self.client.getCurrentUrl().then(function (url) { self.src = url.trim(); });
  }
};

util.inherits(IFrameObj, events.EventEmitter);

IFrameObj.prototype.getSource = function(callback) {
  var self = this;
  if (this.source !== null) { if (callback) { callback(self.$, self.source); } }
  else {
    self.client.getPageSource().then(function getSource(source) { 
      self.source = source;
      self.$ = cheerio.load(source);
      if (callback) { callback(self.$, self.source); };
    });
  }
};

IFrameObj.prototype.emitSource = function () {
  var self = this;
  console.log('emit source');
  self.root.emit('found-source', self.src, self.$, self.source);

};

//IFrameObj.prototype.findSelector = function (selector) {
//  var self = this;
//  var foundElement = false;
//  return self.client.findElements(selector).then(function IFrameObjFindSelectorFindElements(elements) {
//    if (elements.length > 0) { foundElement = true; }
//    self.state = 'seen';

//    if (foundElement) { // found elements here, need to emit found-element with source 
//      self.client.getPageSource().then(function gotPageSource(source) {
//        self.emit('found-element', source);
//      });
//    };
//  });
//}

IFrameObj.prototype.buildFrameMap = function () {
  var self = this;
  var $ = self.$;

  $('iframe').each(function () {
    var newObj = new IFrameObj(self.client, this, self.urlmap, self.depth + 1, self.root);
    newObj.root = self.root;
    self.children.push(newObj);
  });
  self.state = 'seen';
  this.urlmap.push(self.src);
};

IFrameObj.prototype.selectNextFrame = function () {
  // selects the next frame that hasn't been seen before
  console.log(this.src + ': selecting new frame');
  var self = this;
  var frameindex = this.children.findIndex(function findNextFrame(frame) {
    if (frame.getState() === 'unseen') {
      return !self.urlmap.some(frame.src); //skip over frame urls that are in our urlmap, we already saw them
    }
    return false;
  });
  if (frameindex >= 0) {
    var frame = this.children[frameindex];
    console.log('-'.repeat(self.depth + 1) + '> select iframe: ' + frame.src);
    this.client.switchTo().frame(frameindex);
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
    return !self.urlmap.some(child.src);
  });


  var numseen = unseen_children.count(function (n) {
    return (n.getState() != 'unseen');
  });

  if (numseen >= unseen_children.length) { return 'seen'; }
  return 'unseen';
};

IFrameObj.prototype.selectDefault = function () {
  var self = this;
  console.log('<' + '-'.repeat(self.depth + 1) + ' select root frame');
  self.client.switchTo().defaultContent(); // goes back to the "default" frame
  self.root.search();
};

IFrameObj.prototype.search = function () {
  var self = this;
  function selectFrameLogic() {
    if (self.getState() === 'seen' && self.root === self) {
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


  if (self.state !== 'seen') {
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

var iframeTester = function () {
  var self = this;
  this.weburl = "http://gordallott.com/test/test.html";
  this.client = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  this.client.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load
  this.client.get(this.weburl).then(function () {;
    self.iframe = new IFrameObj(self.client);
    self.iframe.on('finished', function iframeFinished() {
      console.log('iframe selector finished');
    });
    self.iframe.on('found-source', function foundSource(uri, $) {
      console.log('found source: ' + uri);
      $('p').each(function onP() { console.log("<p>" + $(this).text() + "</p>"); });
    });
    self.iframe.search();
  });

};

var tester = new iframeTester();