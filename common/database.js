/*
 * databases.js: the database table
 *
 * Wraps the database connection to share connections.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger').forFile('database.js')
  , mongodb = require('mongodb')
  ;

var database = undefined;

var Database = module.exports;

//
// Public Methods
//
/**
 * Connect to the database.
 *
 * @param {function(err, database)} callback  The callback to consume the database.
 * @return {undefined}
 */
Database.connect = function(callback) {
  callback = callback ? callback : defaultCallback;

  if (database) {
    callback(null, database);
  } else {
    mongodb.MongoClient.connect(config.MONGODB_URL, function(err, db) {
      database = db;
      callback(null, db);
    });
  }
}
