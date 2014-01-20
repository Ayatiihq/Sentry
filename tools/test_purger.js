/*
 * test_purger.js: 
 * (C) 2014 Ayatii Limited
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , fs = require('fs')
  , path = require('path')
  , sugar = require('sugar')

var Infringements = acquire('infringements')
  , Promise = require('node-promise')
  , Seq = require('seq')
  , URI = require('URIjs')  
  ;

function setupSignals() {
  process.on('SIGINT', function () {
    process.exit(1);
  });
}

var SIGNALS = ['started', 'finished', 'error'];

function main() {
  logger.init();
  logger = logger.forFile('test_purger.js');

  setupSignals();

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_purger.js <campaignJSON>");
    process.exit(1);
  }

  var campaign = require(process.argv[2]);
  var infringements_ = new Infringements();
  var Purger = require('../common/roles/purger/purger');
  var instance = new Purger();

  SIGNALS.forEach(function (name) {
    instance.on(name, function () {
      console.log('\nreceived signal', name);
      Object.values(arguments, function (value) {
        if (Object.isObject(value) || Object.isArray(value))
          console.log('\t' + JSON.stringify(value));
        else
          console.log('\t' + value);
      });
    });
  });

  var purgableIds = [];
  
  Seq()
    .seq(function(){
      infringements_.getPurgable(campaign, this)
    })
    .seq(function(purgable_){
      logger.info('go purge : ' + JSON.stringify(purgable_));
      purgableIds = purgable_.map(function(infringement){return infringement._id});
      instance.goPurge(purgable_, this);
    })
    .seq(function(){
      logger.info('finished purging - check results');
    })
    .seq(function(results){
      logger.info('results after purging : ' + JSON.stringify(results));
      process.exit(0);
    })
    .catch(function(err){
      logger.error(err);
      process.exit(1);
    })
    ;
}

main(); 
