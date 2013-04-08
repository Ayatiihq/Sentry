/*
 * test_verifications.js: tests the verificationswrapper
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
  , Verifications = acquire('verifications');

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
  logger = logger.forFile('test_verifications.js');

  setupSignals();

  var verifications = new Verifications();
  var action = argv[2];
  var arg0 = argv[3];

  if (action === 'getForCampaign') {
    var campaign = require(argv[3]);
    var skip = Number(argv[4]);
    var limit = Number(argv[5]);
    verifications.getForCampaign(campaign, skip, limit, log);
  }


  if (action === 'getCountForCampaign') {
    var campaign = require(argv[3]);
    verifications.getCountForCampaign(campaign, log);
  }
}

main()