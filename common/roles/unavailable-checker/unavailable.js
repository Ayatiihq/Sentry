/*
 * unavailable.js: check if link is still available 
 *
 * (C) 2012 Ayatii Limited
 *
 * Unavailable checks links to see if they are available, checking for 404 and
 * soft 404s.
 */

var acquire = require('acquire')
  , fmt = require('util').format
  , logger = acquire('logger').forFile('unavailable.js')
  , utilities = acquire('utilities')
  ;

var Unavailable = module.exports = function() {
  this.init();
}

Unavailable.prototype.init = function() {
  var self = this;
}

Unavailable.prototype.check = function(url, done) {
  var self = this;

  done(null, true, false);
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
