/*
 * test_infringements.js: tests the infringementswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_infringements.js');

  setupSignals();

  var campaigns = new Campaigns();
  var infringements = new Infringements();

  campaigns.listActiveCampaigns(function(err, camps) {
    if (err) {
      console.log(err);
      process.exit();
    }

    var campaign = camps[0];
    var action = argv[2];

    if (action === 'add') {
      var uri = argv[3];
      infringements.add(campaign, uri, 'web', 'test', {});
    }

    if (action === 'addMeta') {
      infringements.addMeta(campaign, argv[3], argv[4], {});
    }

    if (action === 'addRelation') {
      infringements.addRelation(campaign, argv[3], argv[4]);
    }

    if (action === 'addMetaRelation') {
      infringements.addMetaRelation(campaign, argv[3], argv[4], argv[5]);
    }

    setTimeout(function() {

    }, 1000 * 3);

  });
}

main();