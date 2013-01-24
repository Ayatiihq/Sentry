/*
 * test_role.js: start a role
 *
 * (C) 2012 Ayatii Limited
 *
 */
require('acquire');

var config = require('../config')
  , logger = acquire('logger')
  ;

var config = require('../config');

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

  if (process.argv.length !== 3)
  {
    logger.warn("Usage: node test_role.js <name_of_role>");
    process.exit(1);
  }

  var rolename = process.argv[2];
  var Role = require('../roles/' + rolename);
  var instance = new Role();
  instance.on('started', function() {
    logger.info('Started ' + instance.getDisplayName());
  });

  instance.start();
}

main(); 
