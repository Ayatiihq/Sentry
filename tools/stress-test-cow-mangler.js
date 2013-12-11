/*
 * stress-test-cow-mangler.js: 
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

function findCollection(collectionName, args, limitAmount, done){
  database.connect(function(err, db) {
    if(err){
      console.log('Trouble connecting to db: ' +  err);
      return done(err);
    }
    var table = db.collection(collectionName);
    table.find(args).limit(limitAmount).toArray(function(err, results){
                                if(err){
                                  console.log('Couldnt search: ' + err);
                                  return done(err)
                                }
                                console.log('Query results length = ' + results.length);      
                                db.close(function(err){
                                          if(err)
                                            console.log('Error closing db connection !');
                                        });                                   
                                done(null, results);
                              }); 
  });
}

function fetchRegex(downloader){
  var domains = {'4shared': /4shared\.com/g, 
                 'mediafire': /mediafire\.com/g,
                 'sharebeast': /sharebeast\.com/g,
                 'rapidshare': /rapidshare\.com/g,
                 'hulkshare': /hulkshare\.com/g,
                 'rapidgator': /rapidgator\.net/g,
                 'zippyshare': /zippyshare\.com/g};
  return domains[downloader];
}

function openATab(Downloader, campaign, infringement){
  var promise = new Promise.Promise();
  var browser = new Cowmangler();
  
  browser.on('error', function(){
    logger.warn('cowmangler r-u-n-n-o-f-t');
    promise.reject(new Error('cowmangler r-u-n-n-o-f-t'));
  });

  browser.newTab();
  var cyberlocker;

  Seq()
    .seq(function(){
      var that = this;
      browser.on('ready', function(){
        cyberlocker = new Downloader(campaign, browser);
        cyberlocker.download(infringement, that);
      });
    })
    .seq(function(){
      logger.info('Finished downloading');
      cyberlocker.finish(this);
    })
    .seq(function(){
      promise.resolve();
    })
    .catch(function(err){
      logger.warn('Unable to stress test cowmangler %s', err);   
      promise.reject(err);
    })
    ;               
  return promise;
}

function main() {
  logger.init();
  logger = logger.forFile('stress-test-cow-mangler.js');

  if (process.argv.length < 3)
  {
    logger.warn("Usage: node stress-test-cow-mangler.js <campaignId> <cyberlocker-domain> <number-of-tabs?(optional)>");
    process.exit(1);
  }

  var campaign = require(process.argv[2]);  
  var particularDownloader = process.argv[3];
  var desiredTabs = process.argv.length > 4 ? process.argv[4] : null;
  var Downloader = require('../common/roles/downloader/' + particularDownloader);

  Seq()
    .seq(function(){
      var browser = new Cowmangler();
      browser.getStatus(this);
    })
    .seq(function(status){
      var manglerAvailableTabs = 0;
      var manglerBusyTabs = 0;
      logger.info('status : ' + JSON.stringify(status));
      Object.keys(status).each(function(node){
        manglerAvailableTabs += status[node].max_tab_count - status[node].tab_count;
        manglerBusyTabs += status[node].tab_count;
      });

      logger.info('availableTabs : ' + manglerAvailableTabs);
      logger.info('busyTabs : ' + manglerBusyTabs);

      var limit = desiredTabs ? desiredTabs : manglerAvailableTabs;

      var that = this;
      var searchPromise = findCollection('infringements', 
                                         {'campaign': campaign._id,
                                          'category': states.infringements.category.CYBERLOCKER,
                                          'uri': fetchRegex(particularDownloader)},
                                          limit,
                                          this);
    })
    .seq(function(results){
      var that = this;
      var collectedPromises =[]; 
      collectedPromises = results.map(function(r){return openATab(Downloader, campaign, r)});
      Promise.all(collectedPromises).then(function(){
        that();
      },
      function(err){
        that(err);
      });
    })
    .seq(function(){
      logger.info('finished stress testing');
      process.exit(1);   
    })
    .catch(function(err){
      logger.warn('Unable to stress test cowmangler %s', err);   
      process.exit(1);   
    })
    ;
}

main(); 
