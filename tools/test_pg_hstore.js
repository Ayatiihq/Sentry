/*
 * setup-schemas.js: sets up the Sentry schemas on a Postgres database
 *
 *  (C) 2012 Ayatii Limited
 *
 */

var config = require('../config')
  , pg = require('pg').native
  , seq = require('parseq').seq
  , sugar = require('sugar')
  , util = require('util')
  ;

function pgReply(client, err, result) {
  if (err)
    console.log(err);
}

var query = " \
  INSERT INTO scraperjobs \
    (campaign, scraper, properties) \
  VALUES \
    ($1, $2, 'msgId => $3') \
;";

function main() {
  console.log('Testing hstore');

  pg.connect(config.DATABASE_URL, function(err, client) {
    
    client.query(util.format("INSERT INTO scraperjobs (campaign, scraper, properties) VALUES ($1, $2, 'msgId => %s')", '234523452345'),
                 [1, 'test'],
                 function(err, result) {
      if (err) 
        console.log(err);

      process.exit(0);
    });
  });

}

main();