/*
 * worker.js: the worker main loop
 *
 * (C) 2012 Ayatii Limited
 *
 */

var cluster = require('cluster')
  , fs = require('fs')
  , logger = require('winston')
  , net = require('net')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Sentry = require('./sentry').Sentry;

function setupLogging(log) {
  log.remove(logger.transports.Console);
  log.add(logger.transports.Console, { colorize: true, timestamp: true });
}

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  setupLogging(logger);
  setupSignals();

  if (cluster.isMaster) {
    for (var i = 0; i < os.cpus().length; i++) {
      cluster.fork();
    }

    cluster.on('exit', function(worker, code, signal) {
      logger.warn('Worker ' + worker.process.pid + ' died.');
    });

  } else {
    setupLogging(logger);
    setupSignals();

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
      logger.info('Server started (' + SOCKET_FILE + ').');
    });
  }
}

main(); 
