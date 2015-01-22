/*
 * test_dispatcher.js: tests the dispatcherwrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_dispatcher.js');

  setupSignals();

  var Dispatcher = require('../hub/' + argv[2] + '-dispatcher');
  var dispatcher = new Dispatcher();
}

main();