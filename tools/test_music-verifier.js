/*
 * test_musicverifier.js: test an musicverifier
 * (C) 2013 Ayatii Limited
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  , Promise = require('node-promise')
  , fs = require('fs')
  , path = require('path')
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

function gatherInfringements(urisList){
  fs.readFile(path.join(process.cwd(), urisList), function (err, data) {
    if (err) {
      throw err; 
    }
    var infringements = [];
    data.toString().words(function(singular){
      // bad javascript bad bad!
      isState = parseInt(singular) || parseInt(singular) === 0;
      if(isState){
        // make a new infringement when a new state is detected.
        infringements.push({state: parseInt(singular)});
      } 
      else{
        var link = null;
        try{
          link = URI(singular);
          logger.info('just added : ' + link.toString() + ' to a infrg with a state of ' + infringements.last().state);
          infringements.last().uri = link.toString();
        }
        catch(err){
          logger.info('unable to create link ' + singular);
        }
      }
    });
    console.log('infringements size : ' + infringements.length);
  });
}

var SIGNALS = ['started', 'finished', 'error'];

function main() {
  logger.init();
  logger = logger.forFile('test_music-verifier.js');

  setupSignals();

  if (process.argv.length < 3)
  {
    logger.warn("Usage: node test_music-verifier.js <campaignId> <listLocation>");
    process.exit(1);
  }

  var campaign = parseObject(process.argv[2]);
  var infringeURIs = gatherInfringements(process.argv[3]);

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

  var promise = new Promise.Promise();
  instance.evaluate({folderPath:'/home/ronoc/ayatii/test-mp3s/sentry-sandbox/'}, promise);
  promise.then(logger.info('finished'));
}

main(); 
