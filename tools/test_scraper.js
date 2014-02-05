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

var Seq = require('seq')
  , Scrapers = acquire('scrapers')
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

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_scraper.js job");
    process.exit(1);
  }

  var job = require(process.argv[2]);
  var campaigns = new Campaigns();
  var scraperName = job._id.consumer.split('.')[0];
  var browser = null;
  var scraperInfo = null;
  var campaignID = job._id.owner;

  var scrapers = new Scrapers();
  scrapers.on('ready', function(){
    Seq()
      .seq(function(){
        var that  = this;
        scraperInfo = scrapers.getScraper(scraperName);
        if (!scraperInfo) {
          logger.error('unable to load scraper info ' + scraperName);
          process.exit(1);
        }
        // Only create a mangler instance if we actually need it
        if(scraperInfo.dependencies && scraperInfo.dependencies.cowmangler > 0){
          browser = new Cowmangler();
          browser.newTab();
          browser.on('ready', function(){
            that();
          });
        }
        else
          that();
      })
      .seq(function(){
        campaigns.getDetails(campaignID, this);
      })
      .seq(function(campaign_){
        
        var instance = scrapers.loadScraper(scraperInfo.name);
        instance.start(campaign_, job, browser);

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
      })
      .catch(function(err){
        logger.warn(err);
        process.exit(1);
      })
  });

}

main(); 
