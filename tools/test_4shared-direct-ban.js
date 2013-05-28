/*
 * test_4shared-direct-ban.js: test 4shared-direct-ban
 * (C) 2013 Ayatii Limited
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

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

function main() {
  logger.init();
  logger = logger.forFile('test_4shared-direct-ban.js');
  logger.info('test the 4shared direct ban');

  var campaign = parseObject(process.argv[2]);
  var links = ['http://www.4shared.com/download/Whrr3o58/songspkinfo_race_2_-_03_-_lat_.mp3?dsid=28gag2.b150cb6ea2205950cce6ad82386feded&tsid=20130514-052007-75388379'];//'http://example-link-1', 'http://example-link-2', 'http://example-link-3'];
  var fourSharedBanner = require('../common/roles/noticesender/4shared-direct-ban');

  var instance = new fourSharedBanner(campaign, links);
}

main(); 
