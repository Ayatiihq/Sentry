/*
 * test_hosts.js: tests the hostswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , states = acquire('states')
  , sugar = require('sugar')
  ;

var Campaigns = acquire('campaigns')
  , Notices = acquire('hosts');

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

  process.exit();
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_hosts.js');

  setupSignals();

  var hosts = new Notices();
  var action = argv[2];
  var arg0 = argv[3];

  if (action === 'get')
    hosts.get(arg0, log);

  if (action === 'add')
    hosts.add(require(arg0), log);
}

main()