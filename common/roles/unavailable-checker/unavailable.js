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
  , utilities = acquire('utilities')
  ;

var Seq = require('seq');

var MAX_LENGTH = 1500000;

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
      logger.warn('%s is too large to check');
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
      utilities.request(uri, {}, this);
    })
    .seq(function(res, body) {
      origBody = body;
      self.createAndGetTestURL(url, this);
    })
    .seq(function(res, body) {
      testBody = "";
      self.compareBodies(origBody, testBody, this);
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
  var self = this;


}

Unavailable.prototype.compareBodies = function(orig, test, done) {
  var self = this;

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
