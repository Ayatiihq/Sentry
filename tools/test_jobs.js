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

function log(err) {
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));

  process.exit();
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_jobs.js');

  setupSignals();

  var jobs = new Jobs(argv[2]);
  var action = argv[3];
  var id;
  try {
    id = require(argv[4])._id;
  } catch(err) {
    id = null;
  }

  if (action === 'listActiveJobs')
    jobs.listActiveJobs(id, log);

  if(action === 'getDetails')
    jobs.getDetails(id, log);

  if (action === 'nAvailableJobs')
    jobs.nAvailableJobs(console.log);

  if (action === 'push')
    jobs.push(id, argv[5], {}, log);

  if (action === 'pop')
    jobs.pop(log);

  if (action === 'start')
    jobs.start({ _id: id }, log);

  if (action === 'complete')
    jobs.complete({ _id: id }, log);

  if (action === 'close')
    jobs.close({ _id: id }, Number(argv[4]), argv[5], log);

  if (action === 'setMetadata')
    jobs.setMetadata({ _id: id }, JSON.parse(argv[4]), log);

  if (action === 'touch')
    jobs.touch({ _id: id }, log);
}

main();