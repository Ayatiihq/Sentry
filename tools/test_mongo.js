/*
 * test_swarm.js: test Swarm
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
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
  logger = logger.forFile('test_swarm.js');

  setupSignals();

  var servers = [];
  for (var i = 0; i < config.MONGODB_SERVERS.length; i++) {
    servers.push(new mongodb.Server(config.MONGODB_SERVERS[i], config.MONGODB_PORTS[i], { auto_reconnect: false }));
  }

  var replicaSet = new mongodb.ReplSetServers(servers, { rs_name: config.MONGODB_REPLICA_NAME });

  db = new mongodb.Db(config.MONGODB_DATABASE, replicaSet, { safe: false });
  db.open(function(err, db) {
    if (err)
      return console.log(err);

    db.authenticate(config.MONGODB_USERNAME, config.MONGODB_PASSWORD, function(err, result) {
      console.log(err, 'success');
      db.close();
    });
  });
}

main(); 
