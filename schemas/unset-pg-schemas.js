/*
 * setup-schemas.js: sets up the Sentry schemas on a Postgres database
 *
 *  (C) 2012 Ayatii Limited
 *
 */

var pg = require('pg').native
  , seq = require('parseq').seq
  , sugar = require('sugar');

var connString = process.env.DATABASE_URL || "postgres://njpatel@localhost/njpatel";

var drops = [ "DROP TABLE notices;"
            , "DROP TABLE downloads;"
            , "DROP TABLE verification;"
            , "DROP TABLE users;"
            , "DROP TABLE urirelations;"
            , "DROP TABLE uris;"
            , "DROP TABLE scraperjobs;"
            , "DROP TABLE campaigns;"
            , "DROP TABLE clients;"

            , "DROP EXTENSION hstore;"
];

function pgReply(client, err, result) {
  if (err)
    console.log(err);
}

function main() {
  console.log('Deleting schemas on ' + connString);

  pg.connect(connString, function(err, client) {
    
    drops.forEach(function(query) { 
      client.query(query, function(err, result) {
        if (err)
          console.log(err);

        if (query === drops.at(-1)) {
          pg.end();
          process.exit(0);
        }
      });
    });
  });

}

main();