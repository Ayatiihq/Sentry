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
  var mockInfringement = {uri: "http://dc363.4shared.com/img/315036078/50ab8815/dlink__2Fdownload_2FdNj3AwbI_3Ftsid_3D20120304-124534-773d60d0/preview.mp3"};

  var mgr = new CyberlockerManager();
  console.log('Does CyberlockerManager support uri : ' + mgr.canProcess(mockInfringement));
  mgr.process(mockInfringement);
}

main(); 
