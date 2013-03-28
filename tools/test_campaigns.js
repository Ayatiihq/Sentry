/*
 * test_campaigns.js: tests the campaignswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var Campaigns = acquire('campaigns');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_campaigns.js');

  setupSignals();

  var campaigns = new Campaigns();

  if (argv[2] === 'add') {
    var data = JSON.parse(argv[3]);
    campaigns.add(data, console.log);
  }

  if (argv[2] === 'update') {
    var query = JSON.parse(argv[3]);
    var updates = JSON.parse(argv[4]);
    campaigns.update(query, updates, console.log);
  }

  if (argv[2] === 'remove') {
    var query = JSON.parse(argv[3]);
    campaigns.remove(query, console.log);
  }

  setTimeout(function() {
    campaigns.listActiveCampaigns(function(err, list) {
      if (err)
        console.warn(err);
      else
        console.log(list);
    });
  }, 1000 * 3);
}

main();