/*
 * test_cyberlocker-manager.js: 
 * (C) 2013 Ayatii Limited
 *
 */
var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , database = acquire('database')
  , Promise = require('node-promise')  
  , states = acquire('states')
  , Seq = require('seq')  
  ;

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

function findCollection(collectionName, args){
  var searchPromise = new Promise.Promise;
  database.connect(function(err, db) {
    if(err){
      console.log('Trouble connecting to db: ' +  err);
      searchPromise.reject(err);
      return;
    }
    var table = db.collection(collectionName);
    table.find(args).toArray(function(err, results){
                                if(err){
                                  console.log('Couldnt search: ' + err);
                                  searchPromise.reject(err);
                                  return;
                                }
                                console.log('Query results length = ' + results.length);      
                                db.close(function(err){
                                          if(err)
                                            console.log('Error closing db connection !');
                                        });                                   
                                searchPromise.resolve(results);      
                              }); 

  });
  return searchPromise;
}

function oneAtaTime(results, cyberlocker){
  Seq(results)
    .seqEach(function(infringement){
      var done = this;
      logger.info('\n\n Downloader just handed in a new infringement ' + infringement.uri + '\n\n');
      cyberlocker.download(infringement, '/tmp', done);
    })
   .seq(function(){
      logger.info('Finished downloading');
      cyberlocker.finish();
    })
    .catch(function(err) {
      logger.warn('Unable to process download job: %s', err);
    })    
    ;
}

function fetchRegex(downloader){
  var domain = require('../common/roles/downloader/' + downloader.split('.')[0]).getDomains()[0];

  switch(domain)
  { 
    case '4shared.com':
      return /4shared/g;
    case 'mediafire.com':
      return /mediafire/g;
    case 'sharebeast.com':
      return /sharebeast/g;
    case 'rapidshare.com':
      return /rapidshare/g;
  }
  return null;
}

function main() {
  logger.init();
  logger = logger.forFile('test_cyberlocker-manager.js');
  setupSignals();

  if (process.argv.length < 3)
  {
    logger.warn("Usage: node test_cyberlocker-downloader.js <campaignId> <cyberlocker-domain>");
    process.exit(1);
  }
  var campaign = parseObject(process.argv[2]);  
  // update with new cyberlockers as they we get to support 'em.
  cyberlockerSupported = ['rapidshare.com', '4shared.com', 'mediafire.com', 'sharebeast.com'].some(process.argv[3]);
  if(!cyberlockerSupported){
    logger.error("hmmm we don't support that cyberlocker - " + process.argv[3]);
    process.exit(1);
  }
  var instance = new (require('../common/roles/downloader/' + process.argv[3].split('.')[0]))(campaign);
  var uriRegex = null;

  uriRegex = fetchRegex(process.argv[3]);

  if(!uriRegex){
    logger.error("Unable to figure out which regex to use!");
    process.exit(1);
  }

  var searchPromise = findCollection('infringements', 
                                     {'campaign': campaign._id,
                                      'category': states.infringements.category.CYBERLOCKER,
                                      'uri': uriRegex, // todo insert cyberlocker using regex object.
                                      'state' : states.infringements.state.NEEDS_DOWNLOAD});
  
  searchPromise.then(function(payload){ oneAtaTime(payload, instance)},
                  function(err){
                    console.log('Error querying database ' + err);
                  });
}

main(); 
