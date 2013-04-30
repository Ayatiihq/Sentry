/*
 * test_role.js: start a role
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , CyberlockerManager = acquire('cyberlocker-manager');
  ;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var task = null;
  logger.init();
  logger = logger.forFile('test_cyberlocker-manager.js');

  setupSignals();
  var mockInfringement = {uri: "http://mediafire.com/file/4e1qyjrnznx/Race%20Theme.mp3"};
  var mockInfringement2 = {uri: "http://www.mediafire.com/?ivvcaz3cchjqj3ei3e3274lci072d1j"};
  
  
  var mgr = new CyberlockerManager();
  console.log('Does CyberlockerManager support uri : ' + mgr.canProcess(mockInfringement2));
  mgr.process(mockInfringement2);
}

main(); 
