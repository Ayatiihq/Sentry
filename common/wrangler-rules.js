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
  , shorteners = acquire('shorteners')
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
   , XRegExp('\.(js|css)')
  ];

  return ignoreUris.some(function ignoreTest(testregex) {
    return testregex.test(uri);
  });

};

module.exports.urlMatch = XRegExp( //ignore jslint
  '(?<fulluri>' +
  '(?<protocol>(?:[a-z0-9]+)                                                               (?#protocol        )' +
  '(?:://))                                                                                (?#:// no capture  )' +
  '(?:                                                                                     (?#captures domain )' +
  '(?:(?<subdomain>[a-z0-9-]+\\.)*(?<domain>[a-z0-9-]+\\.(?:[a-z]+))(?<port>:[0-9]+)?)     (?#subdomain+domain)' +
  '|' +
  '(?<ip>[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}))                               (?#or ip           )' +
  '(?<path>(?:/|%2F)[-a-z0-9+&@#/%=~_\\(\\)|]*(?<extension>\\.[-a-z0-9]+)?)*               (?#full path       )' +
  '(?<paramaters>(?:\\?|%3F)[-a-z0-9+&@#/%=~_\\(\\)|]*)?                                   (?#paramaters      )' +
  ')',
  'gix'); // global, ignore case, free spacing 
 
module.exports.magnetMatch = XRegExp( //ignore jslint 
  '(?<fulluri>' +
  '(?<protocol>(?:[a-z0-9]+)                                                               (?#protocol        )' +
  '(?::))                                                                                  (?#: no capture    )' +
  '(?<paramaters>(?:\\?)[\\.:\\-a-z0-9+&@#/%=~_\\(\\)|]*)                                    (?#paramaters      )' +
  ')'
  ,'gix');


var Endpoint = function (data) {
  this.data = data;
  this.isEndpoint = false;
};

Endpoint.prototype.toString = function () {
  return this.data.toString();
};

module.exports.ruleEmbed = function DomEmbed($, source, uri, foundItems) {
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

module.exports.ruleSwfObject = function SwfObject($, source, uri, foundItems) {
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

module.exports.ruleObject = function DomObject($, source, uri, foundItems) {
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
module.exports.ruleRegexStreamUri = function RegexStreamUri($, source, uri, foundItems) {
  var protocols = ['rtmp://', 'rtsp://', 'rttp://', 'rtmpe://'];
  var extensions = ['.flv', '.mp4', '.m4v', '.mov', '.asf', '.rm', '.wmv', '.rmvb',
                    '.f4v', '.mkv'];

  XRegExp.forEach(source, module.exports.urlMatch, function (match, i) {
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
        XRegExp.forEach(body, module.exports.urlMatch, function (match, i) {
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
    XRegExp.forEach($(this).toString(), module.exports.urlMatch, function (match, i) {
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

var searchTypes = module.exports.searchTypes = {
  START: 0,
  MIDDLE: 1,
  END: 2,
  DOMAIN: 3
};

/**
 * Constructs a list of all possible links before searching for matches from the extensionList
 * depending on the matching algorithm chosen (searchTypes).
 */
var ruleSearchAllLinks = module.exports.ruleSearchAllLinks = function(extensionList, searchType, mimeMatch) {
  var findExtensions = function(extensions, searchType, mimeMatch, $, source, uri, foundItems) {
    var hostname = URI(uri).pathname('').href()
      , links = {}
      , shortenedLinks = []
      , promise = new Promise()
      ;

    // Let's start with getting all links in the page source
    XRegExp.forEach(source, module.exports.urlMatch, function (match, i) {
      var url = match.fulluri.toString();
      try {
        url = url.unescapeURL()
      } catch (err) {}

      links[url] = true;
    });

    // Search fo' magnets
    XRegExp.forEach(source, module.exports.magnetMatch, function (match, i) {
      links[match.fulluri.toString()] = true;
    });

    // Let's then grab all the a links, relative or otherwise
    $('a').each(function() {
      var href = $(this).attr('href');

      if (href) {
        if (href[0] == '/') {
          links[hostname + href] = true;
        
        } else {
          if (!href.startsWith('magnet:')) // Ignore magnet links from cheerio as it chokes on them
            links[href] = true;
        }
      }
    });

    // Now let's see if there are any shorteners and, if so, resolve them
    Object.keys(links, function(link) {
      // FIXME: We can add a cache here to speed up shortener lookups
      try {
        var linkuri = URI(link)
          , domain = linkuri.domain()
          ;
        if (shorteners.knownDomains.some(domain)) {
          shortenedLinks.push(link);
        }
      
      } catch (err) {
        logger.warn('Unable to parse %s as URI', link);
      }
    });

    var promiseArray = shortenedLinks.map(function(link) {
      return utilities.followRedirects([ link ], new Promise());
    });

    all(promiseArray).then(function(lifted30Xs) {
      lifted30Xs.each(function(single30x) {
        links[single30x.last()] = true;
      });

      function linkMatchesExtension(link) {
        var ret = false;

        switch (searchType) {
          case searchTypes.START:
            ret = linkBeginsWith(link, extensions);
            break;

          case searchTypes.MIDDLE:
            ret = linkHas(link, extensions);
            break;

          case searchTypes.END:
            // try to remove the query string (to catch torcache queries)
            ret = linkEndsWith(link.split('?')[0], extensions);
            break;

          case searchTypes.DOMAIN:
            ret = linkIsFrom(link, extensions);
            break;

          default:
            logger.warn('Search type %d is not supported', searchType);
        }

        return ret;
      }

      // Finally, it's time to search for the useful extentions
      Object.keys(links, function(link) {
        if (linkMatchesExtension(link)) {
          var item = new Endpoint(link);
          item.isEndpoint = true;
          foundItems.push(item);
        }
      });

      // actually not finally, we want to go through each of the links now and ping them to check the mimetypes
      // slow as all hell but will find things that are binary that don't have extensions
      var pingPromises = [];
      if (mimeMatch === undefined) { // early exit as the way this was coded is a little awkward, called many times and we only want do this once
        promise.resolve(foundItems);
      }
      else {
        Object.keys(links, function (link) {
          var p = new Promise();
          pingPromises.push(p);
          utilities.requestURLStream(link, {}, function cb(err, req, response, stream) {
            if (err) { p.reject(); return; }

            var mimeType = response.headers['content-type'];
            if (mimeMatch.test(mimeType)) {
              var item = new Endpoint(link);
              item.isEndpoint = true;
              foundItems.push(item);
            }

            p.resolve();
            req.abort(); // we don't care about the actual stream for now
          });
        });

        all(pingPromises).then(function() { promise.resolve(foundItems); });
      }
    });
    return promise;
  }
  
  return findExtensions.bind(null, extensionList, searchType, mimeMatch); 
}


function linkBeginsWith(link, prefixes) {
  for (var i = 0; i < prefixes.length; i++) {
    if (link.startsWith(prefixes[i]))
      return true;
  }
  return false;
}

function linkHas(link, matches) {
  for (var i = 0; i < matches.length; i++) {
    if (link.indexOf(matches[i]) >= 0)
      return true;
  }
  return false;
}

function linkEndsWith(link, suffixes) {
  for (var i = 0; i < suffixes.length; i++) {
    if (link.endsWith(suffixes[i]))
      return true;
  }
  return false;
}

function linkIsFrom(link, domains) {
  try {
    var domain = URI(link).domain();
    return domains.some(domain);

  } catch (err) {
    logger.warn('Unable to parse %s for checking domains: %s', link, err);
  }
  return false;
}

/* - Collections, we create collections of rules here just to make the rule/spider codebases less verbose - */
module.exports.rulesLiveTV = [module.exports.ruleEmbed
                             , module.exports.ruleObject
                             , module.exports.ruleRegexStreamUri
                             , module.exports.ruleSwfObject];

var audioExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.wma', '.ogg', '.aac', '.ra', '.m3u', '.pls', '.ogg'];

var videoExtensions = ['.mp4', '.avi', '.mkv', '.m4v', '.dat', '.mov', '.mpeg', '.mpg', '.mpe', '.ogg', '.wmv'];

var p2pExtensions = ['.torrent'];

var magnetPrefixs = ['magnet:'];

var archiveExtensions = ['.zip', '.rar', '.gz', '.tar', '.7z', '.bz2'];

module.exports.rulesDownloadsMusic = [
    ruleSearchAllLinks(audioExtensions, searchTypes.END, /(audio)\//gi)
  , ruleSearchAllLinks(p2pExtensions, searchTypes.END)
  , ruleSearchAllLinks(magnetPrefixs, searchTypes.START)
  , ruleSearchAllLinks(archiveExtensions, searchTypes.END)
];

module.exports.rulesDownloadsMovie = [
    ruleSearchAllLinks(videoExtensions, searchTypes.END, /(video)\//gi)
  , ruleSearchAllLinks(p2pExtensions, searchTypes.END)
  , ruleSearchAllLinks(magnetPrefixs, searchTypes.START)
  , ruleSearchAllLinks(archiveExtensions, searchTypes.END)
];

module.exports.rulesDownloadsTorrent = [
   ruleSearchAllLinks(p2pExtensions, searchTypes.END)
 , ruleSearchAllLinks(magnetPrefixs, searchTypes.START)
];

module.exports.typeExtensions = {
    'music.album': [].include(audioExtensions).include(p2pExtensions).include(archiveExtensions)
  , 'movie': [].include(videoExtensions).include(p2pExtensions).include(archiveExtensions)
}

module.exports.typeMediaExtensions = {
    'music.album': [].include(audioExtensions).include(archiveExtensions)
  , 'movie': [].include(videoExtensions).include(archiveExtensions)
}