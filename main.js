/*
 * main.js: the sentry main loop
 *
 * (C) 2012 Ayatii Limited
 *
 */

var cluster = require('cluster')
  , fs = require('fs')
  , logger = require('./logger')
  , net = require('net')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Sentry = require('./sentry').Sentry;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function mainCluster() {
  for (var i = 0; i < os.cpus().length; i++) {
    logger.info('Forking ' + i + ' Sentry workers')
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    logger.warn('Worker ' + worker.process.pid + ' died: ' + code + ' ' + signal);
  });
}

function mainWorker() {
  var sentry = new Sentry();
  var SOCKET_FILE = os.tmpDir() + '/sentry-' + sentry.getId() + '.sock';

  process.on('exit', function () {
    try {
      fs.unlinkSync(SOCKET_FILE);

    } catch (err) {
      logger.warn(err);
    }
    logger.info('Exiting Sentry');
  });

  var server = net.createServer(function(c) {});
  server.listen(SOCKET_FILE, function() {
    logger.info('Server started (' + SOCKET_FILE + ')');
  });
}

function main() {
  logger.init();
  logger = logger.forFile('main.js');

  setupSignals();

  if (cluster.isMaster) {
    mainCluster();
  } else {
    mainWorker();
  }
}

main(); 
