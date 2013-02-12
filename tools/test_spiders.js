/*
 * test_spiders.js: list spiders
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , net = require('net')
  ;

var Spiders = acquire('spiders');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_spiders.js');

  setupSignals();

  var spiders = new Spiders();
  spiders.on('ready', function() {
    console.log('All spiders: \n');
    console.log(spiders.getSpiders());
    console.log('\n');

    process.exit(0);
  });
}

main(); 
