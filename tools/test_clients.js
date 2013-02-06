/*
 * test_clients.js: tests the clientswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var Clients = acquire('clients');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_clients.js');

  setupSignals();

  var clients = new Clients();

  if (argv[2] === 'add') {
    var data = JSON.parse(argv[3]);
    clients.add(data);
  }

  setTimeout(function() {
    clients.listClients(function(err, list) {
      if (err)
        console.warn(err);
      else
        console.log(list);

      if (list.length && argv[2] === 'remove')
        clients.remove(list[0]);

      if (list.length && argv[2] === 'update') {
        var updates = [];
        updates.PartitionKey = list[0].PartitionKey;
        updates.RowKey = list[0].RowKey;
        updates.testUpdated = true;
        clients.update(updates);
      }
    });
  }, 1000 * 3);
}

main();