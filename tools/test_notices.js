/*
 * test_notices.js: tests the noticeswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */
require('sugar')
var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , states = acquire('states')
  , sugar = require('sugar')
  , Promise = require('node-promise')  
  , database = acquire('database')
  , Storage = acquire('storage')
  , Handlebars = require('handlebars')
  , fs = require('fs')
  , path = require('path')  
  ;

var Campaigns = acquire('campaigns')
  , Notices = acquire('notices')

var reportName = 'genericReportName';

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function log(err) {
  if (err)
    logger.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));

  process.exit();
}


function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_notices.js');

  setupSignals();

  var notices = new Notices();
  var action = argv[2];
  var arg0 = argv[3];

  if (action === 'getReadyForNotice')
    notices.getReadyForNotice(require(arg0), log);

  if (action === 'setTakenDown')
    notices.setTakenDown({ _id: arg0 }, log);

  if (action === 'getForCampaign')
    notices.getForCampaign(require(arg0), argv[4], argv[5], log);

  if (action === 'getCountForCampaign')
    notices.getCountForCampaign(require(arg0), log);
  
  if (action === 'getPendingForCampaign')
    notices.getPendingForCampaign(require(arg0), parseInt(argv[4]), parseInt(argv[5]), log);

  if (action === 'setState')
    notices.setNoticeState({ _id: arg0 }, parseInt(argv[4]), log);

  if (action === 'getNeedsEscalatingForCampaign')
    notices.getNeedsEscalatingForCampaign(require(arg0), log);
}

main()