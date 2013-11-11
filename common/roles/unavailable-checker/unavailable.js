/*
 * unavailable.js: check if link is still available 
 *
 * (C) 2012 Ayatii Limited
 *
 * Unavailable checks links to see if they are available, checking for 404 and
 * soft 404s.
 */

var acquire = require('acquire')
  , difflib = require('difflib')
  , fmt = require('util').format
  , logger = acquire('logger').forFile('unavailable.js')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  ;

var Seq = require('seq');

var MAX_LENGTH = 1500000
  , MIN_RATIO = 0.95
  ;

var Unavailable = module.exports = function() {

}

/**
 * Check to see if a url is available, including checking for soft 404s
 *
 * @param  {string}                            url       The URL to check the existance of
 * @param  {function(err,isAvailable,isSoft)}  done      The callback that is called once a decision is made.
 * @return {undefined}
 */
Unavailable.prototype.check = function(url, done) {
  var self = this;

  self.is400OrMore(url, function(err, isDown, res, stream) {
    if (err) return done(err);

    if (isDown)
      return done(null, false, false);

    if (res.headers['content-length'] > MAX_LENGTH) {
      logger.warn('%s is too large to check', url);
      return done(null, true, false);
    }

    self.isSoft(url, stream, function(err, isSoft) {
      done(err, !isSoft, isSoft);
    });
  });
}

Unavailable.prototype.is400OrMore = function(url, done) {
  var self = this;

  // Get request to give us the headers, including redirects
  utilities.requestStream(url, function(err, req, res, stream, links) {
    if (err && !res) return done(err);

    if (res.statusCode >= 400)
      return done(null, true);

    done(null, false, res, stream);
  });
}

Unavailable.prototype.isSoft = function(url, steam, done) {
  var self = this
    , origBody = ""
    , testBody = ""
    ;

  Seq()
    .seq(function() {
      utilities.request(url, {}, this);
    })
    .seq(function(res, body) {
      origBody = body;
      self.createAndGetTestURL(url, this);
    })
    .seq(function(res, body) {
      testBody = body;
      self.compareBodies(url, origBody, testBody, this);
    })
    .seq(function(isAvailable) {
      done(null, !isAvailable);
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

Unavailable.prototype.createAndGetTestURL = function(url, done) {
  var self = this
    , testURL = ""
    ;
  
  try {
    if (url.endsWith('/'))
      url = url.first(url.length - 1);

    var u = URI(url);
    u.search("").fragment("").filename("");
    u.segment(-1, "");
    testURL = u.toString();
    testURL += makeRandomString();
  } catch(err) {
    return done(err);
  }
  utilities.request(testURL, {}, done);
}

Unavailable.prototype.compareBodies = function(url, orig, test, done) {
  var self = this
    , minRatio = MIN_RATIO
    ;

  seq1 = orig.split(' ');
  seq2 = test.split(' ');
  sm = new difflib.SequenceMatcher(null, seq1, seq2);

  // Quirks
  if (/rapidshare.com/i.test(url))
    minRatio = 0.8;

  done(null, !(sm.ratio() >= minRatio));
}

function makeRandomString()
{
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for( var i=0; i < 25; i++ )
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}

//
// Testing
//
if (require.main == module) {
  var url = process.argv[2]
    , unavailable = new Unavailable()
    ;

  unavailable.check(url, function(err, isAvailable, isSoft) {
    if (err) console.log(err);
    console.log(fmt('%s available (was soft: %s)', isAvailable ? 'is' : 'is not', isSoft));
    process.exit();
  });
}
