/*
 * test_analytics.js: tests the analyticswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , states = acquire('states')
  , sugar = require('sugar')
  ;

var Campaigns = acquire('campaigns')
  , Analytics = acquire('analytics');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function log(err) {
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));

  process.exit();
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_analytics.js');

  setupSignals();

  var analytics = new Analytics();
  var action = argv[2];
  var arg0 = argv[3];

  if (action === 'getClientStats')
    analytics.getClientStats(require(arg0), console.log);

  if (action === 'getCampaignStats')
    analytics.getCampaignStats(require(arg0), log);

  if (action === 'getCampaignAnalytics')
    analytics.getCampaignAnalytics(require(arg0), log);

  if (action === 'getClientAnalytics')
    analytics.getClientAnalytics(require(arg0), log);


  if (action === 'getCampaignCountryData')
    analytics.getCampaignCountryData(require(arg0), log);

  if (action === 'getClientCountryData')
    analytics.getClientCountryData(require(arg0), log);
}

main()