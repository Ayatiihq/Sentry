/*
 * test_roles.js: list roles
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , net = require('net')
  ;

var Roles = acquire('roles');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;

  logger.init();
  logger = logger.forFile('test_roles.js');

  setupSignals();

  var roles = new Roles();
  roles.on('ready', function() {
    console.log('All roles: \n');
    console.log(roles.getRoles());
    console.log('\n');

    process.exit(0);
  });
}

main(); 
