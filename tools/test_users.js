/*
 * test_users.js: tests the userswrapper
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
  , Users = acquire('users');

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
  logger = logger.forFile('test_users.js');

  setupSignals();

  var users = new Users();
  var action = argv[2];
  var arg0 = argv[3];

  if (action === 'list')
    users.list(log);

  if (action === 'add') {
    var userDetails = require(arg0);
    users.add(userDetails, log);
  }

  if (action === 'get')
    users.get(arg0, log);
}

main()