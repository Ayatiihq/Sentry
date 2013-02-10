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

  var campaigns = new Campaigns();
  var jobs = new Jobs('test');

  campaigns.listActiveCampaigns(function(err, camps) {
    if (err) {
      console.log(err);
      process.exit();
    }

    var c = camps[0].RowKey;

    if (argv[2] === 'add') {
      var data = JSON.parse(argv[4]);
      console.log(jobs.add(c, data));
    }

    setTimeout(function() {
      jobs.listActiveJobs(c, function(err, list) {
        if (err) {
          console.warn(err);
          process.exit();
        }

        if(argv[2] === 'details')
          jobs.getDetails(c, list[0].RowKey, console.log);

        if (argv[2] === 'start')
          jobs.start(c, list[0].RowKey);

        if (argv[2] === 'pause')
          jobs.pause(c, list[0].RowKey, { payload: 'this is saved data' });

        if (argv[2] === 'complete')
          jobs.complete(c, list[0].RowKey);

        if (argv[2] === 'close')
          jobs.close(c, list[0].RowKey, argv[3]);

        if(argv[2] === 'metadata')
          jobs.setMetadata(c, list[0].RowKey, { hello: 'world' });
      });
    }, 1000 * 3);

  });
}

main();