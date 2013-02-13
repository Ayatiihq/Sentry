/*
 * test_spider.js: start a spider
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

var SIGNALS = ['started', 'finished', 'error', 'link'];

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_spider.js');

  setupSignals();

  if (process.argv.length !== 3)
  {
    logger.warn("Usage: node test_spider.js <name_of_spider>");
    process.exit(1);
  }

  var spidername = process.argv[2];
  var Spider = require('../roles/spider/spiders/' + spidername);
  var instance = new Spider();
  
  SIGNALS.forEach(function(name) {
    instance.on(name, function() {
      console.log('received signal', name);
      
      Object.values(arguments, function(value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log(JSON.stringify(value));
        else
          console.log(value);
      });
    });
  });

  instance.start();
}

main(); 
