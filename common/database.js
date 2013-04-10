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
  , CONNECTING = false
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

  callback = callback ? callback : function() {};

  if (!DATABASE && CONNECTING) {
    return WAITING.push([Database.connect, Object.values(arguments)]);
  }

  if (DATABASE) {
    callback(null, DATABASE);
  } else {
    logger.info('Connecting to database at %s', config.MONGODB_URL);
    
    CONNECTING = true;
    WAITING = [];

    mongodb.MongoClient.connect(config.MONGODB_URL, 
                                { 
                                  replset: {
                                    strategy: 'ping',
                                    rs_name: 'hydros',
                                    readSecondary: false,
                                    socketOptions: {
                                      connectTimeoutMS: 10000,
                                      socketTimeoutMS: 200000,
                                      keepAlive: 1
                                    }
                                  },
                                  server: 
                                  { 
                                    readPreference: 'primary',
                                    auto_reconnect: true,
                                    socketOptions: { 
                                      connectTimeoutMS: 10000,
                                      socketTimeoutMS: 200000,
                                      keepAlive: 1
                                    }
                                  },
                                  db: {
                                    readPreference: 'primary'
                                  }
                                },
                                function(err, db) {
      if (err && RETRIES < MAX_RETRIES) {
        RETRIES += 1;
        logger.warn('Unable to connect to database: %s. Retrying %s out of %s times',
                    err, RETRIES, MAX_RETRIES)
        setTimeout(Database.connect.bind(null, callback), 1000 * 10 * RETRIES); // Decaying
        return;
      }
      DATABASE = db;
      callback(err, DATABASE);

      db.on('error', function(err) {
        throw err;
      });

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
  callback = callback ? callback : function() {};

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
