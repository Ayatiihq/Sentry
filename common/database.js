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

var DATABASE = undefined
  , MAX_RETRIES = 5
  , RETRIES = 0
  , WAITING = null
  ;

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

  logger.info('Connecting to database');

  callback = callback ? callback : function() {};

  if (DATABASE) {
    callback(null, DATABASE);
  } else {
    WAITING = [];

    mongodb.MongoClient.connect(config.MONGODB_URL, function(err, db) {
      if (err && RETRIES < MAX_RETRIES) {
        RETRIES += 1;
        logger.warn('Unable to connect to database: %s. Retrying %s out of %s times',
                    err, RETRIES, MAX_RETRIES)
        setTimeout(Database.connect.bind(null, callback), 1000 * 4 * RETRIES); // Decaying
        return;
      }
      DATABASE = db;
      callback(err, DATABASE);


      if (WAITING.length) {
        WAITING.forEach(function(call) {
          call[0].apply(null, call[1]);
        });
      }
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

  if (!DATABASE && Object.isArray(WAITING)) {
    return WAITING.push([Database.connectAndEnsureCollection, Object.values(arguments)]);
  }

  Seq()
    .seq('Get database', function() {
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
