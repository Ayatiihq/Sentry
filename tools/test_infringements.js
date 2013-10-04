/*
 * test_infringements.js: tests the infringementswrapper
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
  , Infringements = acquire('infringements');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

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

function log(err) {
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_infringements.js');

  setupSignals();

  var infringements = new Infringements();
  var action = argv[2];

  if (action === 'add') {
    var campaign = argv[3];
    var uri = argv[4];
    infringements.add(campaign, uri, 'web', 'test', states.infringements.state.UNVERIFIED, {source: "from test_infringements 'add'", score: 5, message: 'blurb'}, {}, log);
  }

  if (action === 'addMeta') {
    var campaign = argv[3];
    var uri = argv[4];
    infringements.addMeta(campaign, uri, 'web', 'test-meta', states.infringements.state.UNVERIFIED, {}, log);
  }

  if (action === 'addRelation') {
    var campaign = require(argv[3]);
    var source = argv[4];
    var target = argv[5];
    infringements.addRelation(campaign, source, target, log);
  }

  if (action === 'addMetaRelation') {
    var campaign = require(argv[3]);
    var uri = argv[4];
    infringements.addMetaRelation(campaign, uri, 'test-meta', log);
  }

  if (action === 'addPoints') {
    var infringement = JSON.parse(argv[3]);
    var source = argv[4];
    var score = argv[5];
    var message = argv[6];
    infringements.addPoints(infringement, source, Number(score), message, log);
  }

  if (action === 'setState') {
    var infringement = JSON.parse(argv[3]);
    var state = argv[4];
    infringements.setState(infringement, Number(state), log);
  }

  if (action === 'getNeedsScraping') {
    var campaign = argv[3];
    infringements.getNeedsScraping(campaign, Number(argv[4]), log);
  }

  if (action === 'getNeedsScrapingCount') {
    var campaign = argv[3];
    infringements.getNeedsScrapingCount(campaign, log);
  }

  if (action === 'getOneNeedsScraping') {
    var campaign = require(argv[3]);
    infringements.getOneNeedsScraping(campaign, log);
  }

  if (action === 'getForCampaign') {
    var campaign = require(argv[3]);
    var skip = Number(argv[4]);
    var limit = Number(argv[5]);
    infringements.getForCampaign(campaign, skip, limit, log);
  }

  if (action === 'getCountForCampaign') {
    var campaign = require(argv[3]);
    infringements.getCountForCampaign(campaign, log);
  }

  if (action === 'getNeedsDownloadForCampaign') {
    var campaign = require(argv[3]);
    infringements.getNeedsDownloadForCampaign(campaign, Number(argv[4]), log);
  }
  if (action === 'setMetadata') {
    var infringement = parseObject(argv[3]);
    var key = 'matchedTracks';
    var value = ['matchedTrack-1.mp3', 'matchedTrack-2.mp3'];
    infringements.setMetadata(infringement, key, value);  
  }

  if(action === 'getOneInfringement'){
    infringements.getOneInfringement('a71e8587239e6e91c477f92b26bf58f337811768', log);   
  }
}

main()