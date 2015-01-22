/*
 * test_roles.js: list roles
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var MinerDispatcher = require('../hub/miner-dispatcher');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_roles.js');

  setupSignals();

  var dispatch = new MinerDispatcher();
}

main(); 
