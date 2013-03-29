/*
 * test_jobs.js: tests the jobswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_jobs.js');

  setupSignals();

  var jobs = new Jobs('test');

  if (argv[2] === 'add') {
    var owner = JSON.parse(argv[3]);
    var consumer = argv[4];
    jobs.add(owner, consumer, {}, console.log);
  } else {

    jobs.listActiveJobs(JSON.parse(argv[2]), function(err, list) {
      if (err) {
        console.warn(err);
        process.exit();
      }

      if (argv.length == 3)
        console.log(list);

      if(argv[3] === 'details')
        jobs.getDetails(list[0]._id, console.log);

      if (argv[3] === 'start')
        jobs.start(list[0]);

      if (argv[3] === 'pause')
        jobs.pause(list[0], { payload: 'this is saved data' });

      if (argv[3] === 'complete')
        jobs.complete(list[0]);

      if (argv[3] === 'close')
        jobs.close(list[0], argv[4], argv[5]);

      if(argv[3] === 'metadata')
        jobs.setMetadata(list[0], { hello: 'world' });
    });
  }
}

main();