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
  , logger = acquire('logger').forFile('wrangler-rules.js')
  , Promise = require('node-promise').Promise
  , request = require('request')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
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
   , XRegExp('\\.(js|css)')
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
  '(?<path>(?:/|%2F)[-a-z0-9+&@#/%=~_\\(\\)| ]*(?<extension>\\.[-a-z0-9]+)?)*              (?#full path       )' +
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

// such hack. 
// returns all the links on the page as an endpoint
module.exports.findAllLinks = function ($, source, uri, foundItems) {
  $('a').each(function () {
    var item = new Endpoint(this['0'].attribs.href);
    foundItems.push(item);
  });

  return foundItems;
};

var generateWordHash = function (input) {
  input = input.replace("!,./\\?;:'[]{}|\"", '');
  // could also account for common misspellings, maybe a TODO about that
  // an example would be replacing ie and ei with a hashcode
  return input;
};

/* so this is going to be a bit mental, we want to go through the given html 
 * and figure out if its likely that the site has infringing content specific 
 * to the campaign we are running.
 */
module.exports.checkForInfoHash = 'InfoCheckedAndAccepted';
module.exports.checkForInfo = function (sourceURI, artist, title, tracks, year) {
  var infoChecker = function (albumInfos, $, source, uri, foundItems) {
    var mainText = generateWordHash($('body').text());
    function buildRE(str) {
      return XRegExp(generateWordHash(str), 'igs');
    }
    var titleRegExp = buildRE(albumInfos.title);
    var artistRegExp = buildRE(albumInfos.artist);

    // look in the main text of the page for matches
    var tracksFound = tracks.count(function (track) { return XRegExp.test(mainText, buildRE(track)); });
    var foundAlbum = XRegExp.test(mainText, titleRegExp);
    var foundArtist = XRegExp.test(mainText, artistRegExp);

    // look in the anchor hrefs for matches
    var hrefs = [];
    $('a').each(function () { hrefs.push(this.href); });
    var suspiciousLinks = hrefs.count(function (href) {
      if (!artistRegExp.test(href)) {
        // artist is not in the link title, not trustworthy enough for a link. 
        return 0;
      }
      if (tracks.count(function (track) { return buildRE(track).test(href); }) || titleRegExp.test(href)) {
        return 1;
      }

      return 0;
    });

    // at this point we have all the information we need to make a judgement

    if (foundArtist && (tracksFound || foundAlbum || suspiciousLinks)) {
      // at the very least we need the artist to exist on the page, then we check for tracks/album/suspicious links
      var newitem = new Endpoint('InfoCheckedAndAccepted'); // not a real endpoint, we just use this to take advantage of endpoint wrangler
      newitem.sourceURI = sourceURI;
      newitem.isEndpoint = false;
      foundItems.push(newitem);
    }

    return foundItems;
  };

  return infoChecker.bind(null, { 'artist': artist, 'title': title, 'tracks': tracks, 'year': year });
};

module.exports.ruleEmbed = function DomEmbed($, source, uri, foundItems) {
  $('embed').each(function onEmd() {
    var check = false;
    var sanitized = $(this).toString().toLowerCase();
    check =  check || sanitized.has('stream');
    check = check || sanitized.has('streem');
    check = check || sanitized.has('jwplayer');
    check = check || sanitized.has('Live');

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
    check = check || sanitized.has('new swfobject') && sanitized.has('player');
    if (check) {
      var newitem = new Endpoint(this.toString());
      newitem.isEndpoint = false; // not an endpoint, just html
      foundItems.push(newitem);
    }
  });
  return foundItems;
};

module.exports.ruleObject = function DomObject($, source, uri, foundItems) {
  $('object').each(function onObj() {
    var check = false;
    var sanitized = $(this).toString().toLowerCase();
    check = check || sanitized.has('stream');
    check = check || sanitized.has('streem');
    check = check || sanitized.has('jwplayer');
    check = check || sanitized.has('Live');

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

  XRegExp.forEach(source, module.exports.urlMatch, function (match) {
    // we can extract lots of information from our regexp
    var check = false;
    check = check || protocols.some(match.protocol.toLowerCase());
    if (!!match.extension) { check = check || extensions.some(match.extension.toLowerCase()); }
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
        XRegExp.forEach(body, module.exports.urlMatch, function (match) {
          var check = false;
          check = check || protocols.some(match.protocol.toLowerCase());
          if (!!match.extension) { check = check || extensions.some(match.extension.toLowerCase()); }
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
    XRegExp.forEach($(this).toString(), module.exports.urlMatch, function (match) {
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

var ruleFindMagnetLinks = module.exports.ruleFindMagnetLinks = function ($, source, uri, foundItems) {
  var links = [];
  XRegExp.forEach(source, module.exports.magnetMatch, function (match) {
    var item = new Endpoint(match.fulluri.toString());
    item.isEndpoint = true;
    foundItems.push(item);
  });

  return foundItems;
}

/**
 * Constructs a list of all possible links before searching for matches from the extensionList
 * depending on the matching algorithm chosen (searchTypes).
 */
var ruleSearchAllLinks = module.exports.ruleSearchAllLinks = function (uriTest, mimeMatch) {
  var findExtensions = function (uriTest, mimeMatch, $, source, uri, foundItems) {
    var links = {}
      , shortenedLinks = []
    ;
    var baseURI = null;
    if ($('base').length > 0) { // balls, we have a base tag
      baseURI = $('base').attr('href');
    }

    // Let's start with getting all links in the page source
    XRegExp.forEach(source, module.exports.urlMatch, function (match) {
      var url = match.fulluri.toString();
      try {
        url = url.unescapeURL();
      } catch (err) { }

      var href = utilities.joinURIS(uri, url, baseURI);
      if (href) { links[href] = true; }
    });

    // Let's then grab all the a links, relative or otherwise
    $('a').each(function () {
      var href = utilities.joinURIS(uri, $(this).attr('href'), baseURI);

      if (href) {
        if (!href.startsWith('magnet:')) {// Ignore magnet links from cheerio as it chokes on them
          links[href] = true;
        }
      }
    });

    // why not follow javascript links and see if there is anything in there that is interesting
    // yes, mp3 websites are this stupid

    var accumPromises = $('script').map(function () {
      if ($(this).attr('src')) {
        var ref = utilities.joinURIS(uri, $(this).attr('src'), baseURI);
        if (ref) {
          var promise = new Promise();

          utilities.requestURL(ref, {}, function (err, response, body) {
            if (err) { promise.reject(err); }
            else {
              var jslinks = [];

              XRegExp.forEach(body, module.exports.urlMatch, function (match) {
                var url = match.fulluri.toString();
                try {
                  url = url.unescapeURL();
                } catch (err) { }

                var href = utilities.joinURIS(uri, url, baseURI);
                if (href) { jslinks.push(href); }
              });

              promise.resolve(jslinks);
            }
          });
          return promise;
        }
      }
    });

    return all(accumPromises)
      .then(function (results) {
        results.flatten().compact().each(function (link) { links[link] = true; });
      }, function () { } )
      .then(function () {
        // Now let's see if there are any shorteners and, if so, resolve them
        Object.keys(links, function (link) {
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

        var promiseArray = shortenedLinks.map(function (link) {
          return utilities.followRedirects([link], new Promise());
        });

        return all(promiseArray).then(function (lifted30Xs) {
          lifted30Xs.each(function (single30x) {
            links[single30x.last()] = true;
          });
        });
      })
      .then(function() {
        // Finally, it's time to search for the useful extentions
        Object.keys(links, function (link) {
          if (uriTest(link)) {
            // ignore facebook mp3
            if (link === 'http://www.facebook.com/free.mp3') { return; }
            var item = new Endpoint(link);
            item.isEndpoint = true;
            foundItems.push(item);
          }
        });
      })
      .then(function() {
        // actually not finally, we want to go through each of the links now and ping them to check the mimetypes
        // slow as all hell but will find things that are binary that don't have extensions
        var pingPromises = [];
        Object.keys(links, function (link, value) {
          if (value) { return; } // early return, don't revalidate links we already checked
          var p = new Promise();
          pingPromises.push(p);
          utilities.requestURLStream(link,
                                      { 'timeout': 30 * 1000 },
                                      function cb(err, req, response) {
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

        return all(pingPromises);
      })
      .then(function() { 
        return foundItems;
      });
  };

  return findExtensions.bind(null, uriTest, mimeMatch);
};

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
    logger.error('Unable to parse %s for checking domains: %s', link, err);
  }
  return false;
}

/* - Collections, we create collections of rules here just to make the rule/spider codebases less verbose - */
module.exports.rulesLiveTV = [module.exports.ruleEmbed
                             , module.exports.ruleObject
                             , module.exports.ruleRegexStreamUri
                             , module.exports.ruleSwfObject];

function buildURITest(extensions) {
  return function (uri) {
    var match = XRegExp.exec(uri, module.exports.urlMatch);
    return extensions.some(match.extension);
  };
};

var audioExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.wma', '.ogg', '.aac', '.ra', '.m3u', '.pls', '.ogg'];

var videoExtensions = ['.mp4', '.avi', '.mkv', '.m4v', '.dat', '.mov', '.mpeg', '.mpg', '.mpe', '.ogg', '.wmv'];

var p2pExtensions = ['.torrent'];

var magnetPrefixs = ['magnet'];

var archiveExtensions = ['.zip', '.rar', '.gz', '.tar', '.7z', '.bz2'];

module.exports.rulesDownloadsMusic = [
  ruleSearchAllLinks(buildURITest(audioExtensions.concat(p2pExtensions, archiveExtensions)), /(audio)\//gi),
  ruleFindMagnetLinks
];

module.exports.rulesDownloadsMovie = [
  ruleSearchAllLinks(buildURITest(videoExtensions.concat(p2pExtensions, archiveExtensions)), /(video)\//gi),
  ruleFindMagnetLinks
];

module.exports.rulesDownloadsTorrent = [
  ruleSearchAllLinks(buildURITest(p2pExtensions), /(video)\//gi),
  ruleFindMagnetLinks
];

module.exports.typeExtensions = {
  'music.album': [].include(audioExtensions).include(p2pExtensions).include(archiveExtensions)
  , 'movie': [].include(videoExtensions).include(p2pExtensions).include(archiveExtensions)
};

module.exports.typeMediaExtensions = {
  'music.album': [].include(audioExtensions).include(archiveExtensions)
  , 'movie': [].include(videoExtensions).include(archiveExtensions)
};