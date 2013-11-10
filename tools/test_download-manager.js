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
  logger = logger.forFile('test_download-manager.js');

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_download-manager.js <job>");
    process.exit(1);
  }

  var job = require(process.argv[2]);  
  //logger.info('just loaded : ' + JSON.stringify(job));

  var DownloadManager = require('../common/roles/downloader/download-manager.js');
  var downloadMgr = new DownloadManager();


  Seq()
    .seq(function() {
      downloadMgr.started_ = Date.now();
      downloadMgr.preRun(job, this);
    })
    .seq(function() {
      downloadMgr.run(this);
    })
    .seq(function() {
      downloadMgr.on('finished', function(){
        logger.info('mgr finished');
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
