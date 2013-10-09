/*
 * reporter.js: generate quick reports
 *
 * (C) 2012 Ayatii Limited
 *
 */

require('sugar');
var acquire = require('acquire')
  , database = acquire('database')
  , Promise = require('node-promise')  
  , states = acquire('states')
  , Seq = require('seq')  
  , Notices = acquire('notices')
  , Campaigns = acquire('campaigns')
  , Infringements = acquire('infringements')
  , utilities = acquire('utilities')  
  , Verifications = acquire('verifications')
  , logger = acquire('logger').forFile('reporter.js')  
  , Storage = acquire('storage')
  , Handlebars = require('handlebars')  
  , fs = require('fs')
  , path = require('path')    
  ;

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

function expandInfrgs(infrg_ids, db){
  ids = [];
  infrg_ids.each(function(infr_id){
    ids.push({'_id': infr_id});
  });
  var args = {'$or' : ids};
  return findInfringements(args, db);
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


function preparePendingReport(notices, name){

  logger.info('Notices total : ' + notices.length);
  if(notices.length === 0){
    logger.info('nothing to report here, results are empty');
    process.exit();
  }

  databaseConnection().then(function(db){
    var promArray = [];
    logger.info('Go expand');
    promArray = notices.map(function(notice){ return prepareNotice.bind(null, notice, db)});

    Promise.seq(promArray).then(function(){
      logger.info('write the report \ntotal notices: ' + notices.length);
      writeReport(notices, name).then(function(){
        db.close(function(err){
                  if(err)
                    logger.error('Error closing db connection !');
                });
        });
    });
  });
}

function writeReport(notices, name){
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
                      var context = {'title':  name.replace(/\.html/, ''),
                                     'notices': notices};
                      var output = template(context);
                      var target = path.join(process.cwd(), 'tmp', name);
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

function findFilteredCollection(collectionName, args){
  var searchPromise = new Promise.Promise;
  database.connect(function(err, db) {
    if(err){
      logger.info('Trouble connecting to db: ' +  err);
      searchPromise.reject(err);
      return;
    }
    var table = db.collection(collectionName);
    table.find(args).toArray(function(err, results){
                                if(err){
                                  logger.info('Couldnt search: ' + err);
                                  searchPromise.reject(err);
                                  db.close(function(err){});
                                  return;
                                }
                                logger.info('Query results length = ' + results.length);      
                                searchPromise.resolve(results);
                              }); 

  });
  return searchPromise;
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
      logger.info(err); 
    }
  }
  return ret;
}

function log(err) {
  if (err)
    logger.warn(err);
  else
    logger.info.apply(null, Object.values(arguments).slice(1));

  process.exit();
}

function normalizeClient(campaign) {
 if (campaign._id) {
    // It's an entire campaign row
    return campaign._id;
  } else {
    // It's just the _id object
    return campaign;
  }
}


/*
 * Mark as TakenDown all search engine notices over 2 days old for a given campaign
 *
 */
function markReliablesAsTakeDown(campaign){
  var c = parseObject(campaign)._id;
  var notices_ = new Notices();
  findFilteredCollection('notices', {'host': /[searchengine\.[bing|google]|dailymotion|soundcloud]/,
                         'campaign' : c,
                         'state' : 0,
                         'created': {$lt: (2).daysAgo().getTime()}}).then(function(notices){
                            Seq(notices)
                              .seqEach(function(notice){
                                var that = this;
                                notices_.setTakenDown(notice, that);
                              })
                              .seq(function(){
                                logger.info('Finished marking all search engine notices that are over two days old as taken down');
                                process.exit();
                              })                    
                              .catch(function(err) {
                                logger.warn('Unable to process take downs: %s', err);
                              })    
                            ;                    
                 });
}

/*
 * Search for errors
 *
 */
function searchForErrors(machineName, PID){
  var searchPromise = new Promise.Promise;
  database.connect(function(err, db) {
    if(err){
      logger.info('Trouble connecting to db: ' +  err);
      searchPromise.reject();
      return;
    }
    var table = db.collection('jobs');
    table.find({ who: machineName + '-' + PID }).toArray(function(err, results){
      if(err){
        logger.info('problem searching for job errors ' + err);
        searchPromise.reject();
        return;
      }
      searchPromise.resolve(results);
    });
  });
  return searchPromise;
}

/*
 * Fetch the most recent notices sent to a certain hostemail
 *
 */
function fetchMostLikelyNotices(hostEmail, howManyDaysFromToday){
  
  if(!howManyDaysFromToday) howManyDaysFromToday=7;
  
  var h = new RegExp('(' + hostEmail.replace(/\./, '\.') + ')', 'ig');

  
  var noticeArgs = {'metadata.to' : h,
                    'created' : {'$gt' : (howManyDaysFromToday).daysAgo().getTime()}};

  var getNoticesInfo = findFilteredCollection('notices', noticeArgs);
  getNoticesInfo.then(function(notices){
    var name = 'notices-for-' + hostEmail + '.html';
    preparePendingReport(notices, name);
  });
}

/*
 * Create a highpointer verified infringement
 *
 */
function addADefiniteHighPointer(campaign, uri){
  
  var infringements = new Infringements();
  var verifications = new Verifications();

  database.connectAndEnsureCollection('infringements', function(err, db, infringements_) {

    var maxPoints = 100;
    var c = parseObject(campaign)._id;
    var cType = parseObject(campaign).type;

    infringements.add(c,
                      uri,
                      cType,
                      'manual-added, cc',
                      -1,
                      {'score' : 100, 'source' : 'manual'},
                      {}, 
                      function(err) {
                        if (err){
                          logger.info('add err ' + err);
                          return;
                        }
                        infringements.addMeta(c, uri, cType, 'manual, cc', -1, {}, 
                          function(err) {
                            if (err){
                              logger.info('meta add err ' + err);
                            return;
                          }
                          var entry = {started : Date.now(),
                                       who : "Manual, cc",
                                       finished : Date.now(),
                                       states: states.VERIFIED};
                          verifications.submit({'uri': uri}, entry, log);
                        });
                      });

  });
}

/*
 * Analyse a Domain's amount of infringements
 *
 */
function getInfringementsOfaCertainDomainForaCampaign(campaign, uri){
  var c = parseObject(campaign)._id;
  var h = new RegExp('(' + utilities.getHostname(uri).replace(/\./, '\.') + ')', 'i');

  logger.info('campaign ' + JSON.stringify(c) + '\nhost query : ' + h.toString() + '\nhostname : ' + utilities.getHostname(uri));
  
  var query =  {campaign : c,
                uri : h};

  var searchIPromise = findFilteredCollection('infringements', query);
  
  searchIPromise.then(function(collection){
    collection.each(function(result){
      logger.info('Found infringement ' + result.uri + ' with state ' + JSON.stringify(result) + '\n\n');
      if(result.uri === uri)
        logger.info('WE HAVE A MATCH - infringement exists in the database');
    });
  });  
}

function main() {

  var action = process.argv[2];
  
  if (action === 'add'){
    if(process.argv.length < 5){
      logger.info('not enough args');
      process.exit();
    }
    addADefiniteHighPointer(process.argv[3], process.argv[4]);
  }

  if (action === 'check'){
    if(process.argv.length < 5){
      logger.info('not enough args');
      process.exit();
    }
    getInfringementsOfaCertainDomainForaCampaign(process.argv[3], process.argv[4])
  }
  
  if (action === 'errorSearch'){
    if(process.argv.length < 5){
      logger.info('not enough args');
      process.exit();
    }    
    searchForErrors(process.argv[3], process.argv[4]).then(function(results){
      logger.info(JSON.stringify(results));
    });
  }

  if (action === 'automaticTakeDowns'){
    if(process.argv.length < 4){
      logger.info('not enough args');
      process.exit();
    }
    markReliablesAsTakeDown(process.argv[3]);  
  }

  if (action === 'investigateEmail'){
    if(process.argv.length < 4){
      logger.info('not enough args');
      process.exit();
    }
    fetchMostLikelyNotices(process.argv[3])
  }

  if (action === 'pendingNotices'){
    if(process.argv.length < 6){
      logger.info('not enough args');
      process.exit();
    }
    var notices_ = new Notices();
    var campaign = parseObject(process.argv[3]);
    reportName = (parseInt(process.argv[4])).daysAgo().format('{Weekday}-{d}-{Month}') + 
                  '-' + (parseInt(process.argv[5])).daysAgo().format('{Weekday}-{d}-{Month}') +
                  '-' + campaign.name.dasherize().toLowerCase() + '.html'; 

    databaseConnection().then(function(err, db){
      notices_.getPendingForCampaign(campaign,
                                     parseInt(process.argv[4]),
                                     parseInt(process.argv[5]),
                                     function(err, notices){
                                       preparePendingReport(notices, reportName);
                                     });
    },
    function(err){
      logger.info('error connecting to db');
    });
  }
}

main();
