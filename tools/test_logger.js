"use strict";
/*
 * test_logger.js: start a scraper
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

function testerror() {
  throw new Error('omg');
}


function main() {
  logger.initServer();
  logger = logger.forFile('test_logger.js')

  logger.trace('traced logging');
  logger.debug('debug message');
  logger.info('info message ${name} loves ${treat}s', {name:'gord', treat:'hi-chew'});
  logger.warn('warn message: %d', 10);
  logger.error('error message');

  try { testerror(); }
  catch (err) { logger.error('error message with error: ', err) }
}

if (require.main === module) {
  main();
}
