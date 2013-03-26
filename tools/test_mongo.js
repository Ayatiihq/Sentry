/*
 * test_swarm.js: test Swarm
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger')
  , mongodb = require('mongodb')
  ;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  logger.init();
  logger = logger.forFile('test_mongodb.js');

  setupSignals();

  database.connect(function(err, db) {
    console.log(err, 'success on url');

    db.createCollection('clients', function(err, items) {
      db.collectionsInfo(function(err, cursor) {
        cursor.toArray(function(err, items) {
          console.log(items);
          db.close();
        });
      });
    });
  });
}

main(); 
