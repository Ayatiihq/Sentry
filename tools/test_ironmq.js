/*
 * test_ironmq.js: list ironmq
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , mq = require('ironmq')(config.IRONMQ_TOKEN)(config.IRONMQ_PROJECT)
  , logger = acquire('logger')
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
  logger = logger.forFile('test_ironmq.js');

  setupSignals();

  mq.list(function(err, obj) {
    console.log('--- list');
    console.log(JSON.stringify(obj));
  });

  mq.queues('test').put('{ "name": "neil" }', function(err, obj) {
    console.log('--- put');
    console.log(err ? err : obj);
  });

  mq.queues('test').info(function(err, obj) {
    console.log('--- info');
    console.log(err ? err : obj.size);
  });
}

main(); 
