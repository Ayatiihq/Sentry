/*
 * test_clients.js: tests the clientswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
    azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function count(table, partition) {
  var count = 0;

  tableService_ = azure.createTableService(config.AZURE_CORE_ACCOUNT,
                                           config.AZURE_CORE_KEY);

  var query = azure.TableQuery.select('PartitionKey')
                              .from(table)
                              .where('PartitionKey eq ?', partition);

  function reply(err, entities, res) {
    count += entities.length;

    if (err)
      console.log(err);

    if (res.hasNextPage()) {
      res.getNextPage(reply);
      console.log('continuing search...(', count, 'so far)');
    } else {
      console.log('Count:', count);
    }
  }

  tableService_.queryEntities(query, reply);
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_clients.js');

  setupSignals();

  count(argv[2], argv[3]);
}

main();