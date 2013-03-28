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

var Seq = require('seq');

var DATABASE = undefined;

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
  callback = callback ? callback : function() {};

  if (DATABASE) {
    callback(null, DATABASE);
  } else {
    mongodb.MongoClient.connect(config.MONGODB_URL, function(err, db) {
      DATABASE = db;
      callback(null, DATABASE);
    });
  }
}


/**
 * Connect to database and ensure collection exists
 *
 * @param {string}  collectionName   The name of the collection.
 * @param {function(err, database, collection)}   callback  The callback to consume the database and collection
 * @return {undefined} 
 */
 Database.connectAndEnsureCollection = function(collectionName, callback) {
  if (!collectionName)
    return logger.warn('Collection name required');

  callback = callback ? callback : function() {};

  Seq()
    .seq('Get Database', function() {
      Database.connect(this);
    })
    .seq('Ensure collection', function(db) {
      var that = this;
      db.createCollection(collectionName, function(err) {
        that(err, db);
      });
    })
    .seq('done', function(db) {
      callback(null, db, db.collection(collectionName));
    })
    .catch(function(err) {
      callback(err);
    })
    ;
 }
