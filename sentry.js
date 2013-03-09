/*
 * sentry.js: the sentry command line tool
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , logger = acquire('logger')
  , os = require('os')
  , sugar = require('sugar')
  ;

var HubTask = require('./hubtask.js')
  , RunTask = require('./runtask.js')
  ;

var hub;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function usage() {
  console.log('Usage: node sentry.js [options]');
  console.log('');
  console.log('Options:');
  console.log('');

  console.log('\thub ping [data]', '\tPings the hub with [data]');

  console.log('');
}

function done(err) {
  if (err) {
    console.warn(err);
    console.trace();
  }

  process.exit(err ? 1 : 0);
}

function main() {
  var task = process.argv[2]
    , subtask = process.argv[3]
    , subtaskArgs = process.argv.slice(4)
    , longRunningTask = null
    ;

  logger.init();
  logger = logger.forFile('sentry.js');

  setupSignals();

  if (task === 'run') {
    longRunningTask = new RunTask(subtask, subtaskArgs, done);

  } else if (task === 'hub') {
    longRunningTask = new HubTask(subtask, subtaskArgs, done);

  } else {
    usage();
    done();
  }

  /* Allow a 10 sec run time to subtasks for them to get something longer running */
  setTimeout(function() {}, 10000);
}

main(); 
