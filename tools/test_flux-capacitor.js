/*
 * test_flux-capacitor.js: flux-capacitor
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , net = require('net')
  ;

var FluxCapacitor = require('../hub/flux-capacitor');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_flux-capacitor.js');

  setupSignals();

  var capacitor = new FluxCapacitor();
  setTimeout(function() {
    capacitor.getWork(function(work) {
      console.log(work);
    });
  }, 1000 * 2);
}

main(); 
