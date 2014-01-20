/*
 * test_musicverifier.js:
 * (C) 2013 Ayatii Limited
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , fs = require('fs')
  , path = require('path')
  , sugar = require('sugar')

var Promise = require('node-promise')
  , Seq = require('seq')
  , URI = require('URIjs')  
  ;

function setupSignals() {
  process.on('SIGINT', function () {
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

var SIGNALS = ['started', 'finished', 'error', 'campaign-audio-ready'];

function main() {
  logger.init();
  logger = logger.forFile('test_music-verifier.js');

  setupSignals();

  if (process.argv.length < 2)
  {
    logger.warn("Usage: node test_music-verifier.js <campaignJSON>");
    process.exit(1);
  }

  var campaign = parseObject(process.argv[2]);
  var infringements = [{"_id":"8806fb6bf54366344f08eea1a9f1ecb0c32a6e31",
                      "campaign": "9cf6eb20f3a151f867548578d21c7de002435dcd",
                      "category":3,
                      "children":{"count":0,"uris":[]},"created":1370545325747,"downloads":1,"metadata":{},
                      "created": 1389484800000,
                      "mimetypes":["audio/mpeg"],
                      "parents":{"count":1,"modified":1370545325749,
                      "uris":["http://mp3oak.com/song/file/1/board-of-canada-mp3.html"]},
                      "points":{"total":20,"modified":1370545325747,
                      "entries":[{"score":20,"source":"scraper.generic","message":"Endpoint","created":1370545325747}]},
                      "downloads" : [{"md5": "cc84e1301992a4b7bba4ce4a12bb71d5",
                                      "mimetype" : "audio/mpeg",
                                      "fileSize" : "19.4", //obviously this should be in bytes 
                                      "processedBy" : [],
                                      "created" : Date.now()},
                                      {"md5": "fb91ccc5041a1f7f06eda8b7b6647099",
                                      "mimetype" : "audio/mpeg",
                                      "fileSize" : "8.3",
                                      "processedBy" : [],
                                      "created" : Date.now()}],
                      "popped":1370548822088,
                      "processed":1370546427068,
                      "scheme":"http",
                      "source":"generic",
                      "type":"music.album",
                      "uri":"http://mp3oak.com/sc/file/tL0jB/TgfgwPFbNS2o.mp3",
                      "verified":1370548862188,
                      "state" : 1}, //verified
                      {"_id":"8806fb6bf54366344f08eea1a9f1ecb0c32a6e31",
                      "campaign": "9cf6eb20f3a151f867548578d21c7de002435dcd",
                      "category":3,
                      "created": 1389484800000,
                      "children":{"count":0,"uris":[]},"created":1370545325747,"downloads":1,"metadata":{},
                      "mimetypes":["audio/mpeg"],
                      "parents":{"count":1,"modified":1370545325749,
                      "uris":["http://mp3oak.com/song/file/1/board-of-canada-mp3.html"]},
                      "points":{"total":20,"modified":1370545325747,
                      "entries":[{"score":20,"source":"scraper.generic","message":"Endpoint","created":1370545325747}]},
                      "downloads" :  [{"md5": "9c1c2abf163d4536c3ff790c43adf4cb",
                                      "mimetype" : "audio/mpeg",
                                      "fileSize" : "8.3",
                                      "processedBy" : [],
                                      "created" : Date.now()}],
                      "popped":1370548822088,
                      "processed":1370546427068,
                      "scheme":"http",
                      "source":"generic",
                      "state":2,// false positive
                      "type":"music.album",
                      "uri":"http://mp3oak.com/sc/file/tL0jB/TgfgwPFbNS2o.mp3",
                      "verified":1370548862188}];

  /*
                                      {"md5": "9c1c2abf163d4536c3ff790c43adf4cb",
                                      "mimetype" : "audio/mpeg",
                                      "fileSize" : "8.3",
                                      "processedBy" : [],
                                      "created" : Date.now()},
                                      {"md5": "fb91ccc5041a1f7f06eda8b7b6647099",
                                      "mimetype" : "audio/mpeg",
                                      "fileSize" : "8.3",
                                      "processedBy" : [],
                                      "created" : Date.now()}],
  */

  var MusicVerifier = require('../common/roles/autoverifier/musicverifier');
  var instance = new MusicVerifier();

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

  Seq(infringements)
    .seqEach(function(infringement){
      var that = this;
      instance.verify(campaign, infringement, infringement.downloads, function(err){
        if(err){
          logger.warn('Verify Err : ' + err);
          return that(err);
        }
        that();
      });
    })
    .seq(function(){
      logger.info('finished verifying');
      process.exit(0);
    })
    .catch(function(err){
      logger.error(err);
      process.exit(1);
    })
    ;
}

main(); 
