/*
 * test_campaigns.js: tests the campaignswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , fs = require('fs')
  , logger = acquire('logger')
  , path = require('path')
  ;

var Campaigns = acquire('campaigns');

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
  logger = logger.forFile('test_campaigns.js');

  setupSignals();

  var campaigns = new Campaigns();
  var action = argv[2];

  if (action === 'listActiveCampaigns')
    campaigns.listActiveCampaigns(log);

  if (action === 'listCampaignsForClient')
    campaigns.listCampaignsForClient(argv[3], log);

  if (action === 'add') {
    var data = JSON.parse(argv[3]);
    campaigns.add(data, log);
  }

  if (action === 'update') {
    var id = JSON.parse(argv[3]);
    var updates = JSON.parse(argv[4]);
    campaigns.update(id, updates, log);
  }

  if (action === 'remove') {
    var id = JSON.parse(argv[3]);
    campaigns.remove(id, log);
  }

  if (action === 'save')
    campaigns.save(require(argv[3]), log);

  if (action === 'export') {
    var dir = argv[3];

    campaigns.listActiveCampaigns(function(err, campaigns) {
      if (err)
        return console.warn(err);

      console.log('Exporting %d campaigns', campaigns.length);
      campaigns.forEach(function(campaign) {
        var filename = path.join(dir, campaign.name.dasherize().toLowerCase() + '.json');
        var buffer = JSON.stringify(campaign, null, '\t');
        console.log('Exporting %s', filename);
        fs.writeFileSync(filename, buffer);
      });
      process.exit();
    });
  }
}

main();