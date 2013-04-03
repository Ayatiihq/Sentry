"use strict";
/*jslint white: true */
/*
 * wrangler-rules.js - rules to feed the wrangler with
 *
 * (C) 2013 Ayatii Limited
 *
 *
 */
require('sugar');
var acquire = require('acquire')
  , all = require('node-promise').all
  , cyberLockers = acquire('cyberlockers')
  , events = require('events')
  , logger = acquire('logger').forFile('wrangler-rules.js')
  , Promise = require('node-promise').Promise
  , request = require('request')
  , URI = require('URIjs')
  , util = require('util')
  , utilities = acquire('utilities')
  , when = require('node-promise').when
  , XRegExp = require('xregexp').XRegExp
;

module.exports.shouldIgnoreUri = function (uri) {
  var ignoreUris = [
    XRegExp('^IAMERROR$') // allows us to ignore uris that fail URI(), basically javascript; nonsense
   , XRegExp('facebook')   // like button
   , XRegExp('google')     // +1
   , XRegExp('twitter')    // tweet
   , XRegExp('://ad\\.')    // common ad subdomain
   , XRegExp('/ads[0-9]*(\\.|/)') // foo.com/ads1.php or foo.com/ads/whateverelse
   , XRegExp('banner')
   , XRegExp('adjuggler')
   , XRegExp('yllix') // yllix.com - ads
   , XRegExp('(cineblizz|newzexpress|goindialive|webaddalive|awadhtimes|listenfilmyradio)') // generic add landing pages
  ];

  return ignoreUris.some(function ignoreTest(testregex) {
    return testregex.test(uri);
  });

};

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


var Endpoint = function (data) {
  this.data = data;
  this.isEndpoint = false;
};

Endpoint.prototype.toString = function () {
  return this.data.toString();
};

module.exports.ruleEmbed = function DomEmbed($, source, foundItems) {
  $('embed').each(function onEmd() {
    var check = false;
    var sanitized = $(this).toString().toLowerCase();
    check |= sanitized.has('stream');
    check |= sanitized.has('streem');
    check |= sanitized.has('jwplayer');
    check |= sanitized.has('Live');

    if (check) {
      var newitem = new Endpoint(this.toString());
      newitem.isEndpoint = false; // not an endpoint, just html
      foundItems.push(newitem);
    }
  });
  return foundItems;
};

module.exports.ruleSwfObject = function SwfObject($, source, foundItems) {
  $('script').each(function onScript() {
    var check = false;
    var sanitized = $(this).html().toLowerCase();
    check |= sanitized.has('new swfobject') && sanitized.has('player');
    if (check) {
      var newitem = new Endpoint(this.toString());
      newitem.isEndpoint = false; // not an endpoint, just html
      foundItems.push(newitem);
    }
  });
  return foundItems;
}

module.exports.ruleObject = function DomObject($, source, foundItems) {
  $('object').each(function onObj() {
    var check = false;
    var sanitized = $(this).toString().toLowerCase();
    check |= sanitized.has('stream');
    check |= sanitized.has('streem');
    check |= sanitized.has('jwplayer');
    check |= sanitized.has('Live');

    if (check) {
      var newitem = new Endpoint(this.toString());
      newitem.isEndpoint = false; // not an endpoint, just html
      foundItems.push(newitem);
    }
  });
  return foundItems;
};

/* A more complicated rule, this one needs to be async so instead of returning an array
   it returns a promise and resolves that promise asyncronously
*/
module.exports.ruleRegexStreamUri = function RegexStreamUri($, source, foundItems) {
  var protocols = ['rtmp://', 'rtsp://', 'rttp://', 'rtmpe://'];
  var extensions = ['.flv', '.mp4', '.m4v', '.mov', '.asf', '.rm', '.wmv', '.rmvb',
                    '.f4v', '.mkv'];

  XRegExp.forEach(source, urlmatch, function (match, i) {
    // we can extract lots of information from our regexp
    var check = false;
    check |= protocols.some(match.protocol.toLowerCase());
    if (!!match.extension) { check |= extensions.some(match.extension.toLowerCase()); }
    if (check) {
      var newitem = new Endpoint(match.fulluri.toString());
      newitem.isEndpoint = true;
      foundItems.push(newitem);
    }

  });

  // function that for a given uri will simply open it and parse it for extensions and protocols. 
  // in addition it works through promises, it will return a promise that will be resolved after 
  // the uri is scraped.
  function xmlRule(uri) {
    var xmlPromise = new Promise();
    var matches = [];

    request(uri, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        XRegExp.forEach(body, urlmatch, function (match, i) {
          var check = false;
          check |= protocols.some(match.protocol.toLowerCase());
          if (!!match.extension) { check |= extensions.some(match.extension.toLowerCase()); }
          if (check) {
            var newitem = new Endpoint(match.fulluri.toString());
            newitem.isEndpoint = true;
            matches.push(newitem);
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
        xmlscrapes.push(xmlRule(match.fulluri));
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

/* - Rules to identify links to files on a known cyberlocker - */
module.exports.ruleCyberLockers = function cyberLockerLink($, source, foundItems) {
  var promiseArray;
  var flattened = [];
  var promise;
  // first Rip out links into an array
  $('a').each(function () {
    var hrefValue = $(this).attr('href');
    if (hrefValue && !module.exports.shouldIgnoreUri(hrefValue) && !flattened.some(hrefValue)) {
      flattened.push(hrefValue);
    }
  });


  flattened.each(function buildPromises(ulink) {
    promiseArray.push(utilities.followRedirects([ulink], new Promise.Promise()));
  });

  promise = new Promise.Promise();

  all(promiseArray).then(function onRedirectFollowingFinished(lifted30Xs) {
    lifted30Xs.each(function (list) {
      // keep the list together inorder to associate redirects with initial scraped link.
      list.each(function (resolvedLink) {
        var URILink;
        try {
          URILink = URI(resolvedLink);
        }
        catch (error) {
          return; // some dodgy link => move on.
        }
        if (cyberLockers.knownDomains.some(URILink.domain())) {
          foundItems.push(list);
        }
      });
    });
    promise.resolve(foundItems);
  });
  return promise;
};

// finds any links that match the extensions in the extension list
var ruleFindExtensions = module.exports.ruleFindExtensions = function (extensionList) {

  var retfun = function findExtensions(extensions, $, source, foundItems) {
    XRegExp.forEach(source, urlmatch, function (match, i) {
      // we can extract lots of information from our regexp
      var check = false;
      if (!!match.extension) { check |= extensions.some(match.extension.toLowerCase()); }
      if (check) {
        var newitem = new Endpoint(match.fulluri.toString());
        newitem.isEndpoint = true;
        foundItems.push(newitem);
      }
    });

    return foundItems;
  };

  return retfun.bind(null, extensionList);
};

/* - Collections, we create collections of rules here just to make the rule/spider codebases less verbose - */
module.exports.rulesLiveTV = [module.exports.ruleEmbed
                             , module.exports.ruleObject
                             , module.exports.ruleRegexStreamUri
                             , module.exports.ruleSwfObject];

var audioExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.wma', '.ogg', '.aac', '.ra', '.m3u', '.pls'];

module.exports.rulesDownloadsMusic = [//module.exports.ruleCyberLockers,
                                      ruleFindExtensions(audioExtensions)];

