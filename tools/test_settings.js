/*
 * test_infringements.js: tests the infringementswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Settings = acquire('settings');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_infringements.js');

  setupSignals();

  var settings = new Settings('foo.bar');
  var action = argv[2];

  if (action === 'get')
    settings.get(argv[3], console.log);

  if (action === 'getAll')
    settings.getAll(console.log);

  if (action === 'set')
    settings.set(argv[3], JSON.parse(argv[4]));

  if (action === 'delete')
    settings.delete(argv[3]);
}

main();