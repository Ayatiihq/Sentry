/*
 * worker.js: the worker main loop
 *
 * (C) 2012 Ayatii Limited
 *
 */

var logger = require('winston')
  , fs = require('fs')
  , net = require('net')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Sentry = require('./sentry').Sentry;

var SOCKET_FILE = os.tmpDir() + '/sentry-' + Date.now() + '.sock';

function setupLogging(log) {
  log.remove(logger.transports.Console);
  log.add(logger.transports.Console, { colorize: true, timestamp: true });
}

function setupSignals() {
  process.on('exit', cleanUp);
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function cleanUp() {
  try {
    fs.unlinkSync(SOCKET_FILE);

  } catch (err) {
    logger.warn(err);
  }
  logger.info('Exiting Sentry');
}

function main() {
  setupLogging(logger);
  setupSignals();

  var sentry = new Sentry();

  var server = net.createServer(function(c) {});
  server.listen(SOCKET_FILE, function() {
    logger.info('Server started (' + SOCKET_FILE + ').');
  });
}

main(); 
