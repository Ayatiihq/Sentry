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
  console.log("here");
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));

  process.exit();
}

function expandInfrgs(infrg_ids, db){
  promise = new Promise.Promise();
  ids = [];
  infrg_ids.each(function(infr_id){
    ids.push({'_id': infr_id});
  });
  var args = {'$or' : ids};
  return findInfringements(args, db);
}

function findInfringements(args, db){
  var searchPromise = new Promise.Promise();
  var table = db.collection('infringements');
  table.find(args).toArray(function(err, results){
                           if(err){
                                console.log('Couldnt search: ' + err);
                                searchPromise.reject(err);
                                return;
                              }
                              searchPromise.resolve(results);      
                            }); 
  return searchPromise;
}

function prepareNotice(notice, db){
  var p = new Promise.Promise();
  notice.created = Date.create(notice.created).format();
  expandInfrgs(notice.infringements, db).then(function(completeInfringements){
    notice.infringements = completeInfringements;
    p.resolve();
  });
  return p;
}

function databaseConnection(){
  var x = new Promise.Promise();
  database.connect(function(err, db) {
    if(err){
      console.log('Trouble connecting to db: ' +  err);
      x.reject(err);
      return;
    }
    x.resolve(db);
  });
  return x;
}


function preparePendingReport(err, notices){
  if(err){
    logger.error('Error generating pending report : ' + err);
    return;
  }
  console.log('found ' + notices.length + ' notices.');
  
  databaseConnection().then(function(db){
    var promArray = [];
    promArray = notices.map(function(notice){ return prepareNotice.bind(null, notice, db)});

    Promise.seq(promArray).then(function(){
      writeReport(notices);
      db.close(function(err){
                if(err)
                  console.log('Error closing db connection !');
              });                                   
    });
  });
}

function writeReport(notices){
  storage = new Storage('reports');

  storage.getToText('notices.pending.template', {},
                    function(err, data){
                      if(err){
                        logger.info('problem opening template file');
                        return;
                      }
                      var template = Handlebars.compile(data);
                      var context = {'title': 'Pending Notices for ' + reportName.replace(/\.html/, ''),
                                     'notices': notices};
                      var output = template(context);
                      fs.writeFile('/home/ronoc/sandbox/afive/sentry/' + reportName,
                                    output,
                                    function(err){
                                      if(err)
                                        logger.info('problem writing pending notices report');
                                  });                
                    });
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

  if (action === 'generatePendingReport'){
    var campaign = require(arg0);
    reportName = campaign.name.replace(/\s/g, '') +
                 '-' + (parseInt(argv[4])).daysAgo().format('{Weekday}{d}{Month}') + 
                 '-' + (parseInt(argv[5])).daysAgo().format('{Weekday}{d}{Month}') + '.html'; 
    notices.getPendingForCampaign(campaign,
                                  parseInt(argv[4]),
                                  parseInt(argv[5]),
                                  preparePendingReport);
  }
}

main()