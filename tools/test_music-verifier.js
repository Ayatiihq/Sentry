/*
 * test_musicverifier.js: test an musicverifier
 * (C) 2013 Ayatii Limited
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  , promise = require('node-promise');
  ;

function setupSignals() {
  process.on('SIGINT', function () {
    process.exit(1);
  });
}

var SIGNALS = ['started', 'finished', 'error'];

function main() {
  logger.init();
  logger = logger.forFile('test_music-verifier.js');

  setupSignals();

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_music-verifier.js folderPath");
    process.exit(1);
  }

  var MusicVerifier = require('../common/roles/autoverifier/musicverifier');
  var instance = new MusicVerifier();

  SIGNALS.forEach(function (name) {
    instance.on(name, function () {
      console.log('\nreceived signal', name);
      Object.values(arguments, function (value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log('\t' + JSON.stringify(value));
        else
          console.log('\t' + value);
      });
    });
  });

  var track = {folderPath: process.argv[2]};
  var promise = new promise.Promise();
  instance.evaluate(track, promise);
  promise.then(logger.info('finished'));
}

main(); 
