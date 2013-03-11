/*
 * test_dependencies.js: dependencies
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , net = require('net')
  ;

var Dependencies = require('../hub/dependencies');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_dependencies.js');

  setupSignals();

  var deps = new Dependencies();
  deps.isAvailable('selenium', 1, function(err, available) {
    console.log(err, available);
  });

  deps.getStatus('selenium', function(err, status) {
    console.log(err, status);
  });
}

main(); 
