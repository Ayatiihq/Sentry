/*
 * test_swarm.js: test Swarm
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var Swarm = acquire('swarm');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  logger.init();
  logger = logger.forFile('test_swarm.js');

  setupSignals();

  var swarm = new Swarm();
  
  swarm.listMasters(function(err, masters) {
    if (err)
      console.warn(err);
    console.log('\n' + masters.length + ' Masters:');
    console.log(masters);
  });

  swarm.listWorkers(function(err, workers) {
    if (err)
      console.warn(err);
    console.log('\n' + workers.length + ' Workers:');
    console.log(workers);
  });
}

main(); 
