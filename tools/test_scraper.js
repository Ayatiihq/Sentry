/*
 * test_scraper.js: start a scraper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Campaigns = acquire('campaigns');

function setupSignals() {
  process.on('SIGINT', function () {
    process.exit(1);
  });
}

var SIGNALS = ['started', 'finished', 'error', 'infringement', 'metaInfringement', 'relation', 'metaRelation', 'infringementStateChange'];

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
  var task = null;

  logger.init();
  logger = logger.forFile('test_scraper.js');

  setupSignals();

  if (process.argv.length < 4)
  {
    logger.warn("Usage: node test_scraper.js <nameOfScraper> <clientId> <campaignId>");
    process.exit(1);
  }

  var scrapername = process.argv[2];
  var Scraper = require('../common/scrapers/' + scrapername);
  var instance = new Scraper();

  SIGNALS.forEach(function (name) {
    instance.on(name, function () {
      console.log('\nreceived signal', name);
      Object.values(arguments, function (value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log('\t' + JSON.stringify(value));
        else
          console.log('\t' + value);
      });
    });
  });

  var campaign = parseObject(process.argv[3]);
  var job = process.argv[4] ? parseObject(process.argv[4]) : {};

  if (Object.isObject(campaign)) {
    instance.start(campaign, job);
  } else {
    var campaignId = process.argv[3];
    var campaigns = new Campaigns();
    campaigns.getDetails(campaignId, function(err, campaign) {
      if (err)
        console.error(err);
      else
        instance.start(campaign, job);
    });
  }
}

main(); 
