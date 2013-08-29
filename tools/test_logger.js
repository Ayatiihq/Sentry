"use strict";
/*
 * test_logger.js: start a scraper
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger').forFile('test_logger.js')
  , sugar = require('sugar')
  ;

function testerror() {
  throw new Error('omg');
}


function main() {
  logger.info('info message');
  logger.warn('warn message');
  logger.error('error message');

  try { testerror(); }
  catch (err) { logger.error('error message with error: ', err) }
}

if (require.main === module) {
  main();
}