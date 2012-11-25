/*
 * test_role.js: start a role
 *
 * (C) 2012 Ayatii Limited
 *
 */

var logger = require('../logger')
  , net = require('net')
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

  if (process.argv.length !== 3)
  {
    logger.warn("Usage: node test_role.js <name_of_role>");
    process.exit(1);
  }

  var rolename = process.argv[2];
  logger.info('Starting role ' + rolename);

  var Role = require('../roles/' + rolename).Role;
  var instance = new Role();

  var server = net.createServer(function() {});
  server.listen(8001);
}

main(); 
