/*
 * test_role.js: start a role
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_role.js');

  setupSignals();

  var rolename = process.argv[2];
  var Role = require('../common/roles/' + rolename);
  var instance = new Role();
  instance.on('started', function() {
    logger.info('Started ' + instance.getDisplayName());
  });

  instance.start();
}

main(); 
