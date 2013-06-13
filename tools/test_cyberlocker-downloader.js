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
      logger.info('\n\n Downloader just handed in a new infringement ' + infringement.uri);
      cyberlocker.download(infringement, '/tmp/hulk', done);
    })
    .catch(function(err){
      logger.warn('Unable to process download job: %s', err);      
    })
   .seq(function(){
      logger.info('Finished downloading');
      cyberlocker.finish();
    })
    ;
}

function fetchRegex(downloader){
  var domain = require('../common/roles/downloader/' + downloader.split('.')[0]).getDomains()[0];
  var domains = {'4shared.com': /4shared/g, 
                 'mediafire.com': /mediafire/g,
                 'sharebeast.com': /sharebeast.com/g,
                 'rapidshare.com': /rapidshare.com/g,
                 'hulkshare.com': /hulkshare.com/g,
                 'filestube.com': /filestube.com/g};
  return domains[domain];
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
  cyberlockerSupported = ['rapidshare.com', '4shared.com', 'mediafire.com', 'sharebeast.com', 'hulkshare.com', 'filestube.com'].some(process.argv[3]);
  // update with new cyberlockers as they we get to support 'em.
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
                                      'state': states.infringements.state.NEEDS_DOWNLOAD,
                                      'category': states.infringements.category.CYBERLOCKER,
                                      'uri': uriRegex});
  
  searchPromise.then(function(payload){ oneAtaTime(payload, instance)},
                  function(err){
                    console.log('Error querying database ' + err);
                  });
}

main(); 
