"use strict";
/*
 * google.js: a google scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper that can scrape all types of media and always takes 5mins to complete
 * it's job. It can be paused and, if so, it will resume it's five minute
 * timeout.
 *
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('google-scraper.js')
  , util = require('util')
  , webdriver = require('selenium-webdriverjs')
  , sugar = require('sugar')
  , cheerio = require('cheerio')
  , IFrameExploder = acquire('iframe-exploder')
  , XRegExp = require('xregexp').XRegExp;
;


var Scraper = acquire('scraper');

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' };
// matches with named groups, will match url encoded urls also

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

var Generic = module.exports = function () {
  this.init();
};

util.inherits(Generic, Scraper);

Generic.prototype.init = function () {
  var self = this;
};

//
// Overrides
//
Generic.prototype.getName = function () {
  return "Generic";
};

Generic.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign);
  self.emit('started');

  this.client = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities(CAPABILITIES).build();
  this.client.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load
  this.client.get(campaign).then(this.setupIFrameHandler.bind(this));
  self.foundobjs = [];
};

Generic.prototype.checkMatch = function(match) {
  // checks a given xregexp match for potential streams
  var protocols = ['rtmp', 'rtsp', 'rttp'];
  var extensions = ['.flv', '.mp4', '.m4v', '.mkv', '.mpeg', '.mov', '.asf', '.avi', '.rm', '.wmv'];
  var check = false;
  check |= protocols.any(match.protocol.toLowerCase());
  if (!!match.extension) {
    check |= extensions.any(match.extension.toLowerCase());
  }

  // we probably also want to check domain and ip against known streaming domains/ip's but that is difficult to do here
  // right now
  return check;
}

Generic.prototype.setupIFrameHandler = function () {
  var self = this;
  self.iframe = new IFrameExploder(self.client);
  self.iframe.debug = true; // don't do this in production, too noisy

  self.iframe.on('finished', function iframeFinished() { // when we are finished it's safe to use self.client again
    console.log('iframe selector finished');
    console.log('found ' + self.foundobjs.length + ' items of interest');

    self.foundobjs.each(function (val) {
      console.log('possible infringement at ' + val.uri);
      console.log(val.toString());
    });
  });

  self.iframe.on('found-source', function foundSource(uri, parenturls, $, source) {
    // uri is the uri of the current iframe
    // parenturls is a list of parents, from closest parent iframe to root iframe
    // $ is a cheerio object from the source
    // source is a text representation of how the browser views the current DOM, it may be missing various things
    // or have additional things added. it is not the same as just wgetting the html file. 


    // we look for a few generic tag names, we should do more in production, regex over the entire source for example.
    $('object').each(function onObj() { this.parenturls = parenturls; this.uri = uri; self.foundobjs.push(this); });
    $('embed').each(function onEmd() { this.parenturls = parenturls; this.uri = uri; self.foundobjs.push(this); });
    $('param').each(function onFlashVars() {
      if ($(this).attr('name').toLowerCase().trim() === 'flashvars') {
        this.parenturls = parenturls;
        this.uri = uri;
        self.foundobjs.push(this);
      }
    });

    XRegExp.forEach(source, urlmatch, function (match, i) {
      // we can extract lots of information from our regexp
      if (self.checkMatch(match)) {
        self.foundobjs.push(match);
      }
    }, self);

  });

  // call to start the whole process
  self.iframe.search();
};

Generic.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Generic.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};

// no infrastructure support right now, so just make object for testing
var test = new Generic();
//test.start('http://google.com/', '');
test.start('http://www.newtvworld.com/India-Live-Tv-Channels/bbc-world-news-live-streaming.html', '');