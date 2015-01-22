/*
 * test_autoverifier.js: test an autoverifier
 *
 * (C) 2013 Ayatii Limited
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

var SIGNALS = ['started', 'finished', 'error'];

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
  logger = logger.forFile('test_autoverifier.js');

  setupSignals();

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_autoverificatier.js <campaignId>");
    process.exit(1);
  }

  var AutoVerifier = require('../common/roles/autoverifier/autoverifier');
  var instance = new AutoVerifier();

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

  var campaign = parseObject(process.argv[2]);

  if (Object.isObject(campaign)) {
    instance.start(campaign);
  } else {
    var campaignId = process.argv[3];
    var campaigns = new Campaigns();
    campaigns.getDetails(campaignId, function(err, campaign) {
      if (err)
        console.error(err);
      else
        instance.start(campaign);
    });
  }
}

main(); 
