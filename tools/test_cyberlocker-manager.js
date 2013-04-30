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
  var mockInfringement3 = {uri: "http://mediafire.com/file/wyyyznmzjq4/ajabpremkighazabkahani13%28www.mp3songspk.blogspot.com%29.mp3"};
  
  
  var mgr = new CyberlockerManager();
  console.log('Does CyberlockerManager support uri : ' + mgr.canProcess(mockInfringement3));
  mgr.process(mockInfringement3);
}

main(); 
