/*
 * test_links.js: tests the links
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Links = acquire('links');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_links.js');

  setupSignals();

  var links = new Links();
  var action = argv[2];

  if (action === 'getLive') {
    links.getLive(Date.utc.create(argv[3]), console.log);
  }

  if (action === 'addLive') {
    var link = JSON.parse(argv[3]);
    links.addLive(link);
  }
}

main();