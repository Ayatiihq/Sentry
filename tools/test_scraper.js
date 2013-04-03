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
      console.log('received signal', name);
      
     Object.values(arguments, function (value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log(JSON.stringify(value));
        else
          console.log(value);
      });
    });
  });

  var campaign = undefined;

  // conor don't remove this next time ;)
  try {
    campaign = require(process.argv[3]);
  } catch (err) {
    if (process.argv[3].endsWith('.json'))
      console.log(err);
    try {
      campaign = JSON.parse(process.argv[3]);
    } catch (err) { console.log(err); }
  }
  

  if (Object.isObject(campaign)) {
    instance.start(campaign);
  } else {
    var campaignId = process.argv[3];
    var campaigns = new Campaigns();
    campaigns.getDetails(campaignId, function(err, campaign) {
      if (err)
        console.log(err);
      else
        instance.start(campaign);
    });
  }
}

main(); 
