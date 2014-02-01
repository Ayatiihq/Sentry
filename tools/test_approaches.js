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

  if (process.argv.length < 3)
  {
    logger.warn("Usage: node test_approaches.js <campaignId> hostId");
    process.exit(1);
  }

  var hosts_ = new Hosts();
  var campaign = require(process.argv[2]);  
  var targetHostId = process.argv[3];
  var Mangling = require('../common/roles/downloader/mangling');
  var manglingApproach = null; 

  Seq()
    .seq(function(){
      //logger.info('get the details for ' + targetHostId);
      hosts_.get(targetHostId, this);
    })
    .seq(function(targetHost_){
      //logger.info('get the details for ' + JSON.stringify(targetHost_));
      manglingApproach = new Mangling(campaign, targetHost_);
      this();
    })
    .seq(function(){
      manglingApproach.download({uri: "http://www26.zippyshare.com/v/36883838/file.html"},
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

      /*var that = this;
      var searchPromise = findCollection('infringements', 
                                         {'campaign': campaign._id,
                                          'category': states.infringements.category.CYBERLOCKER,
                                          'uri': fetchRegex(particularDownloader)});
      searchPromise.then(function(payload){ 
                          oneAtaTime(payload, instance, that)},
                            function(err){
                              console.log('Error querying database ' + err);
                          });*/
      //var examples = [{uri: 'http://mediafire.com/?mdm1yzkizkm'}, {uri: 'http://mediafire.com/?4pdcw3bmr0wouv7'}];
      //var examples = [{uri: 'http://www.4shared.com/mp3/hhPmI9Im/kanye_west__-_golddigger.html'}, 
      //                {uri: 'http://4shared.com/mp3/RU1lz0r1/Corona_-_The_Rhythm_Of_The_Nig.html'}];
