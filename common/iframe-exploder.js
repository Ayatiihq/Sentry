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
var IFrameObj = function (client, selector, element, urlmap, depth) {
  var self = this;
  events.EventEmitter.call(this);
  this.depth = (depth === undefined) ? 0 : depth;
  this.root = null;
  this.selector = selector;
  this.element = (element === undefined) ? null : element;
  this.client = client;
  this.children = [];
  this.urlmap = (urlmap === undefined) ? [] : urlmap;

  this.state = 'unseen';

  if (this.element !== null) {
    this.element.getAttribute('src').then(function onSrcFound(src) {
      self.src = src;
    });
  };
};

util.inherits(IFrameObj, events.EventEmitter);

IFrameObj.prototype.findSelector = function (selector) {
  var self = this;
  var foundElement = false;
  return self.client.findElements(selector).then(function IFrameObjFindSelectorFindElements(elements) {
    if (elements.length > 0) { foundElement = true; }
    self.state = 'seen';

    if (foundElement) { // found elements here, need to emit found-element with source 
      self.client.getPageSource().then(function gotPageSource(source) {
        self.emit('found-element', source);
      });
    };
  });
}

IFrameObj.prototype.buildFrameMap = function () {
  var self = this;
  return self.client.findElements(webdriver.By.css('iframe')).then(function buildFrames(elements) {
    for (var i = 0; i < elements.length; i++) {
      var newObj = new IFrameObj(self.client, self.selector, elements[i], self.urlmap, self.depth + 1);
      newObj.root = (self.root === null) ? self : self.root;
      self.children.push(newObj);
    };
  });
};

IFrameObj.prototype.selectNextFrame = function () {
  // selects the next frame that hasn't been seen before
  console.log(this.src + ': selecting new frame');
  var self = this;
  var frameindex = this.children.indexOf(function findNextFrame(frame) {
    if (frame.getState() === 'unseen') {
      return !self.urlmap.some(frame.src); //skip over frame urls that are in our urlmap, we already saw them
    }
    return false;
  });
  if (frameindex >= 0) {
    var frame = this.children[frameindex];
    console.log('-'.repeat(self.depth + 1) + '> select iframe: ' + frame.src);
    this.urlmap.push(frame.src);
    this.client.switchTo(frameindex);
    frame.search();
  }
  else {
    throw new Error('Tried to select a frame when already selected all frames', this);
  }
};

IFrameObj.prototype.getState = function () {
  var self = this;
  // state is a combination of children states
  if (this.state === 'unseen') { return 'unseen'; };
  var unseen_children = this.children.filter(function (child) {
    return !self.urlmap.some(child.src);
  });

  if (this.children.length < 1) { return 'endpoint'; } // we have no children, so we are an endpoint;
  else {
    var numseen = unseen_children.count(function (n) {
      return (n.getState() != 'unseen');
    });
    if (numseen >= unseen_children.length) { return 'seen'; }
    return 'unseen';
  }
};

IFrameObj.prototype.search = function () {
  var self = this;
  function selectFrameLogic() {
    if (self.getState() === 'seen' && self.root === null) {
      // we are root and have seen all our children
      self.emit('finished');
    }
    else if (self.getState() === 'endpoint') {
      if (self.root === null) { self.emit('finished'); }
      else {
        console.log('<' + '-'.repeat(self.depth + 1) + ' select root frame');
        self.client.switchTo.defaultContent(); // goes back to the "default" frame
        self.root.search();
      }
    }
    else {
      self.selectNextFrame();
    }
  };


  if (self.state !== 'seen') {
    // we have not seen this yet, so we need to build a framemap and all that 
    // gubbins
    self.findSelector(self.selector)
        .then(function () { return self.buildFrameMap(); })
        .then(selectFrameLogic);
  }
  else {
    selectFrameLogic();
  }
};

var iframeTester = function () {
  var self = this;
  this.weburl = "http://www.newtvworld.com/India-Live-Tv-Channels/bbc-world-news-live-streaming.html";
  this.client = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  this.client.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load
  this.client.get(this.weburl).then(function () {;
    self.iframe = new IFrameObj(self.client, webdriver.By.css('object'));
    self.iframe.on('finished', function iframeFinished() {
      console.log('iframe selector finished');
    });
    self.iframe.on('found-selector', function foundSelector(source) {
      console.log('found selector');
    });
    self.iframe.search();
  });

};