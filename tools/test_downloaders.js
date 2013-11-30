/*
 * test_downloaders.js: 
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , database = acquire('database')
  , Promise = require('node-promise')  
  , states = acquire('states')
  , Seq = require('seq')  
  , Cowmangler = acquire('cowmangler')
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

function oneAtaTime(results, cyberlocker, done){
  Seq(results)
    .seqEach(function(infringement){
      logger.info('\n\n Downloader just handed in a new infringement ' + infringement.uri);
      cyberlocker.download(infringement, this);
    })
    .catch(function(err){
      logger.warn('Unable to process download job: %s', err);      
    })
   .seq(function(){
      logger.info('Finished downloading');
      cyberlocker.finish(function(err){
        done(err);
        process.exit(1);
      });
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
                 'rapidgator': /rapidgator\.net/g,
                 'zippyshare': /zippyshare\.com/g};
  return domains[downloader];
}

function main() {
  logger.init();
  logger = logger.forFile('test_downloaders.js');

  if (process.argv.length < 3)
  {
    logger.warn("Usage: node test_downloaders.js <campaignId> <cyberlocker-domain>");
    process.exit(1);
  }

  var campaign = require(process.argv[2]);  
  var particularDownloader = process.argv[3];
  var browser;
  var instance;
  
  browser = new Cowmangler();
  browser.on('ready', function(){logger.info('we are cowmangling')});
  browser.on('error', function(){
    logger.warn('cowmangler r-u-n-n-o-f-t');
    process.exit(1);
  });
  
  Seq()
    .seq(function(){
      var Downloader = require('../common/roles/downloader/' + particularDownloader);
      instance = new Downloader(campaign, browser);
      this();
    })
    .seq(function(){
      var that = this;
      var searchPromise = findCollection('infringements', 
                                         {'campaign': campaign._id,
                                          'category': states.infringements.category.CYBERLOCKER,
                                          'uri': fetchRegex(particularDownloader)});
      searchPromise.then(function(payload){ 
                          oneAtaTime(payload, instance, that)},
                            function(err){
                              console.log('Error querying database ' + err);
                          });
      //var examples = [{uri: 'http://mediafire.com/?mdm1yzkizkm'}, {uri: 'http://mediafire.com/?4pdcw3bmr0wouv7'}];
      //var examples = [{uri: 'http://www.4shared.com/mp3/hhPmI9Im/kanye_west__-_golddigger.html'}, 
      //                {uri: 'http://4shared.com/mp3/RU1lz0r1/Corona_-_The_Rhythm_Of_The_Nig.html'}];
      //oneAtaTime(examples, instance, this);
    })
    .seq(function(){
      logger.info('finished testing ' + particularDownloader);
      instance.finish(this);
    })
    .seq(function(){
      process.exit(1);   
    })
    .catch(function(err){
      logger.warn('Unable to kick start downloader %s', err);   
      process.exit(1);   
    })
}

main(); 
