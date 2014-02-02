/*
 * test_downloader-manager.js: 
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

function main() {
  logger.init();
  logger = logger.forFile('test_downloader.js');

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_downloader.js <job>");
    process.exit(1);
  }

  var job = require(process.argv[2]);  
  logger.info('just loaded : ' + JSON.stringify(job));

  var Downloader = require('../common/roles/downloader/downloader.js');
  var downloader = new Downloader();

  Seq()
    .seq(function() {
      downloader.started_ = Date.now();
      downloader.preRun(job, this);
    })
    .seq(function() {
      downloader.run(this);
    })
    .seq(function() {
      downloader.on('finished', function(){
        logger.info('finished');
        process.exit(1);
      });      
    })
    .catch(function(err){
    	logger.warn('err - ' + err);
      process.exit(1);
    })
    ;
}

main(); 
