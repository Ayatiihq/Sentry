/*
 * test_announce.js: tests announcements
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var Announce = acquire('announce');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  logger.init();
  logger = logger.forFile('test_announce.js');

  setupSignals();

  var announce = new Announce(function() {
    return { hello: 'world' };
  });
}

main(); 
