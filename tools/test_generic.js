/*
 * test_generic.js: test generic scraper with just one url
 * (C) 2013 Ayatii Limited
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  , Promise = require('node-promise')
  ;

function setupSignals() {
  process.on('SIGINT', function () {
    process.exit(1);
  });
}

function parseObject(arg) {
  var ret = arg;

  try {
    ret = require(arg);
  } catch (err) {
    if (arg.endsWith('.json'))
      console.error(err);
    try {
      ret = JSON.parse(arg);
    } catch (err) { 
      console.log(err); 
    }
  }
  return ret;
}

function main() {
  logger.init();
  logger = logger.forFile('test_generic.js');

  setupSignals();

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_generic.js <campaignJSON> url");
    process.exit(1);
  }

  var campaign = parseObject(process.argv[2]);
  var url = process.argv[3]

  var Generic = require('../common/scrapers/generic/generic-scraper');
  var instance = new Generic();
  var SIGNALS = ['relation', 'infringement', 'infringementStateChange', 'infringementPointsUpdate', 'started', 'finished'];
  SIGNALS.forEach(function (name) {
    instance.on(name, function () {
      console.log('\nreceived signal', name);
      Object.values(arguments, function (value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log('\t' + JSON.stringify(value, null, '  '));
        else
          console.log('\t' + value);
      });
    });
  });
  instance.search_with_one_url(campaign, url);
}
main(); 

