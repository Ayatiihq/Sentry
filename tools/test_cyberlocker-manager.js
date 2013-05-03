/*
 * test_cyberlocker-manager.js: 
 * (C) 2012 Ayatii Limited
 *
 */
var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , database = acquire('database')
  , Promise = require('node-promise')  
  , CyberlockerManager = acquire('cyberlocker-manager');
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
                                console.log('payLoad length = ' + results.length);      
                                db.close(function(err){
                                          if(err)
                                            console.log('Error closing db connection !');
                                        });                                   
                                searchPromise.resolve(results);      
                              }); 

  });
  return searchPromise;
}

function oneAtATime(results){
  results.each(function(infringement){
    console.log('download ' + infringement.uri);
  });
  /*console.log('Does CyberlockerManager support uri : ' + mgr.canProcess(fourshared[0]));
  mgr.process(,
              '/home/ronoc/Desktop/testCBLs', function(results){
                console.log('results are ' + JSON.stringify(results));
              });*/

}

function main() {
  logger.init();
  logger = logger.forFile('test_cyberlocker-manager.js');
  setupSignals();

  var campaign = parseObject(process.argv[2]);

  //var mgr = new CyberlockerManager();
  findCollection('infringements', 
                 {'campaign': { "client" : "Tips Industries Limited", "campaign" : "Ajab Prem Ki Ghazab Kahani" },
                  'category': 2,
                  'uri': /4shared/g,
                  'state' : 8}).then(function(payload){oneAtATime(payload)},
  function(err){
    console.log('Error querying database ' + err);
  });
}

main(); 
