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

function expandInfrgs(infrg_ids, db){
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
                                logger.warn('Couldnt search: ' + err);
                                searchPromise.reject(err);
                                return;
                              }
                              searchPromise.resolve(results);      
                            }); 
  return searchPromise;
}

function prepareNotice(notice, db){
  logger.info('Expand ' + notice.infringements.length 
              + '\ninfringements for notice ' 
              + notice._id + '\ndated : ' 
              + Date.create(notice.created));
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
      logger.error('Trouble connecting to db: ' +  err);
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

  logger.info('Notices total : ' + notices.length);
  
  databaseConnection().then(function(db){
    var promArray = [];
    logger.info('Go expand');
    promArray = notices.map(function(notice){ return prepareNotice.bind(null, notice, db)});

    Promise.seq(promArray).then(function(){
      logger.info('write the report \ntotal notices: ' + notices.length);
      writeReport(notices).then(function(){
        db.close(function(err){
                  if(err)
                    logger.error('Error closing db connection !');
                });
        });
    });
  });
}

function writeReport(notices){
  var p = new Promise.Promise();

  storage = new Storage('reports');

  storage.getToText('notices.pending.template', {},
                    function(err, data){
                      if(err){
                        logger.warn('problem fetching template file');
                        p.resolve();
                        return;
                      }
                      var template = Handlebars.compile(data);
                      var context = {'title':  reportName.replace(/\.html/, ''),
                                     'notices': notices};
                      var output = template(context);
                      var target = path.join(process.cwd(), 'tmp', reportName);
                      logger.info('about to write ' + target);
                      fs.writeFile( target,
                                    output,
                                    function(err){
                                      if(err)
                                        logger.info('problem writing pending notices report');
                                      logger.info('done');
                                      p.resolve();
                                  });                
                    });
  return p;
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
    reportName = (parseInt(argv[4])).daysAgo().format('{Weekday}-{d}-{Month}') + 
                 '-' + (parseInt(argv[5])).daysAgo().format('{Weekday}-{d}-{Month}') + '-' + campaign.name.dasherize().toLowerCase() + '.html'; 
    notices.getPendingForCampaign(campaign,
                                  parseInt(argv[4]),
                                  parseInt(argv[5]),
                                  preparePendingReport);
  }
}

main()