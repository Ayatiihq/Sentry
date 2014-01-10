/*
 * test_scraper.js: start a scraper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , Campaigns = acquire('campaigns')
  , config = acquire('config')
  , Cowmangler = acquire('cowmangler')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

function setupSignals() {
  process.on('SIGINT', function () {
    process.exit(1);
  });
}

var SIGNALS = ['started', 'finished', 'error', 'infringement', 'metaInfringement', 'relation', 'metaRelation', 'infringementStateChange'];

function parseObject(arg) {
  var ret = arg;
  console.log('parseObject ' + arg);
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

  if (process.argv.length < 3)
  {
    logger.warn("Usage: node test_scraper.js <nameOfScraper> <job>");
    process.exit(1);
  }

  var scrapername = process.argv[2];
  var Scraper = require('../common/scrapers/' + scrapername);
  var instance = new Scraper();

  logger.info('create ' + scrapername);

  SIGNALS.forEach(function (name) {
    instance.on(name, function () {
      console.log('\nreceived signal', name);
      Object.values(arguments, function (value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log('\t' + JSON.stringify(value));
        else
          console.log('\t' + value);
      });

      if (name == 'finished')
        process.exit();
    });
  });

  var campaigns = new Campaigns();
  var job = parseObject(process.argv[3]);
  var campaignID = job._id.owner;
  var browser = new Cowmangler();

  browser.on('error', function(err){
    logger.info('error with the cow ' + err);
    process.exit();
  }); 

  browser.on('ready', function(){
    logger.info('Cow is ready');
    campaigns.getDetails(campaignID, function(err, campaign) {
      logger.info("campaign " + campaign.name);
      if (err)
        console.error(err);
      else
        instance.start(campaign, job, browser);
    });
  });

  browser.newTab();
}

main(); 
