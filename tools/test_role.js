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
  var job = require(process.argv[3]);
  
  var Role = require('../common/roles/' + rolename);

  var instance = new Role();

  instance.on('ready', function(){
    if(!job)
      return;
    instance.startJob(job, function(err){
      logger.info(err + ' : ' + JSON.stringify(job));
      process.exit();
    })    
  });

  instance.on('started', function() {
    logger.info('Started ' + instance.getDisplayName());
  });
  instance.on('finished', function() {
    logger.info('Finished ' + instance.getDisplayName());
    process.exit();
  });
  instance.on('error', function(err) {
    logger.info('Error %s: %s', instance.getDisplayName(), err);
  });
  instance.start();
}

main(); 
