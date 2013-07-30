/*
 * test_cyberlocker-manager.js: 
 * (C) 2013 Ayatii Limited
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
      //done();
      cyberlocker.download(infringement, '/tmp', done);
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
  var domains = {'4shared': /4shared\.com/g, 
                 'mediafire': /mediafire\.com/g,
                 'sharebeast': /sharebeast\.com/g,
                 'rapidshare': /rapidshare\.com/g,
                 'hulkshare': /hulkshare\.com/g,
                 'uploaded-net': /uploaded\.net/g,
                 'zippyshare': /zippyshare\.com/g};
  return domains[downloader];
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
  var particularDownloader = process.argv[3];

  var uriRegex = null;

  uriRegex = fetchRegex(particularDownloader);

  var Downloader = require('../common/roles/downloader/' + particularDownloader);
  
  var instance = null;
  instance = new Downloader(campaign);

  if(!uriRegex || !instance || !campaign){
    logger.error("Unable to figure out which regex to use or no Campaign or no instance ! We must not support that downloader " + particularDownloader);
    process.exit(1);
  }

  var searchPromise = findCollection('infringements', 
                                     {'campaign': campaign._id,
                                      'category': states.infringements.category.CYBERLOCKER,
                                      'uri': uriRegex});
  
  searchPromise.then(function(payload){oneAtaTime(payload, instance)},
                  function(err){
                    console.log('Error querying database ' + err);
                  });
}

main(); 
