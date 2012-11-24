/*
 * sentry.js: the sentry main loop
 *
 * (C) 2012 Ayatii Limited
 *
 */

var cluster = require('cluster')
  , logger = require('./logger')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Master = require('./master').Master
  , Worker = require('./worker').Worker;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('main.js');

  setupSignals();

  if (cluster.isMaster) {
    task = new Master();
  } else {
    tast = new Worker();
  }
}

main(); 
