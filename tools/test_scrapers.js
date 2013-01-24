/*
 * test_scrapers.js: list scrapers
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config');
  , logger = acquire('logger')
  , net = require('net')
  ;

var Scrapers = acquire('scrapers');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_scrapers.js');

  setupSignals();

  var scrapers = new Scrapers();
  scrapers.on('ready', function() {
    console.log('All scrapers: \n');
    console.log(scrapers.getScrapers());
    console.log('\n');

    scrapers.getScraperTypes().forEach(function(type) {
      console.log('Scrapers for ' + type);
      console.log(scrapers.getScrapersForType(type));
      console.log('\n');
    });
    console.log(scrapers.hasScraperForType('dummy', 'tv'));

    process.exit(0);
  });
}

main(); 
