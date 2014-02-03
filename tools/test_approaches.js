/*
 * test_approaches.js: 
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , logger = acquire('logger')
  , database = acquire('database')
  , states = acquire('states')

var Hosts = acquire('hosts')
  , Promise = require('node-promise')  
  , Seq = require('seq')  
  ;

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

function oneAtaTime(results, approach, done){
  Seq(results)
    .seqEach(function(infringement){
      approach.download(infringement, this);
    })
    .catch(function(err){
      logger.warn('Unable to process download job: %s', err);      
    })
   .seq(function(){
      logger.info('Finished downloading');
      approach.finish(function(err){
        done(err);
        process.exit(1);
      });
    })                                                                                      
    ;
}

function main() {
  logger.init();
  logger = logger.forFile('test_approaches.js');

  if (process.argv.length < 5)
  {
    logger.warn("Usage: node test_approaches.js <campaignId> hostId uri");
    process.exit(1);
  }
   var downloaderDetails =  {automated : false, 
                            login: {user: {'selector': '',
                                           'value' : ''},
                                    password : {'selector' : '',
                                                'value' : ''},
                                    click : '',
                                    at: '',
                                    authenticated: false},
                            available: [{stepOne:''}, {stepTwo: ''}], // supports two step file grab
                            unavailable: {inSource: [], inUri: []},
                            approach : states.downloaders.approach.COWMANGLING,
                            strategy : states.downloaders.strategy.TARGETED,
                            blacklist : []};

  var hosts_ = new Hosts();
  var campaign = require(process.argv[2]);  
  var targetHostId = process.argv[3];
  var inputUri = process.argv[4];
  var Mangling = require('../common/roles/downloader/mangling');
  var manglingApproach = null; 

  Seq()
    .seq(function(){
      logger.info('get the details for ' + targetHostId);
      hosts_.get(targetHostId, this);
    })
    .seq(function(targetHost_){
      if(!downloaderDetails.automated)
        manglingApproach = new Mangling(campaign, targetHost_);
      else  
        manglingApproach = new Mangling(campaign, Object.merge(targetHost_, downloaderDetails));
      this();
    })
    .seq(function(){
      manglingApproach.download({uri: inputUri},
                                 this);
    })
    .seq(function(){
      manglingApproach.finish(this);
    })
    .seq(function(){
      logger.info('finished testing ' + targetHostId);
      process.exit(0);   
    })
    .catch(function(err){
      logger.warn('Unable to download %s', err);   
      process.exit(1);   
    })
}

main(); 