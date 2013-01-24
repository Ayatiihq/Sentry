/*
 * sentry.js: the sentry main loop
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , logger = acquire('logger')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Master = require('./master')
  , Worker = require('./worker');

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
    task = new Worker();
  }
}

main(); 
