/*
 * test_storage.js: tests the storage
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , fmt = require('util').format
  , fs = require('fs')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Storage = acquire('storage');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function log(err) {
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_storage.js');

  setupSignals();

  var action = argv[2];
  var collection = argv[3];
  var arg0 = argv[4];
  var arg1 = argv[5];

  var storage = new Storage(collection);

  if (action === 'createFromText') {
    storage.createFromText(arg0, arg1, {}, log);
  }

  if (action === 'createFromFile') {
    storage.createFromFile(arg0, arg1, {}, function(err) {
      log(err, fmt('https://qarth.s3.amazonaws.com/%s/%s', collection, arg0));
    });
  }

  // node ./tools/test-storage.js createFromURL torrent testShortener http://bit.ly/Z4buW2
  // and then check goldrush blobl storage under 'torrent'
  if (action === 'createFromURL') {
    storage.createFromURL(arg0, arg1, {}, log);
  }

  if (action === 'getToText') {
    storage.getToText(arg0, {}, log);
  }
}

main();