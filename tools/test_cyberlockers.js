/*
 * test_cyberlockers.js: tests the cyberlockerswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , fs = require('fs')
  , logger = acquire('logger')
  , path = require('path')
  ;

var Cyberlockers = acquire('cyberlockers');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function log(err) {
  if (err)
    console.warn(err);
  else
    console.log.apply(null, Object.values(arguments).slice(1));

  process.exit();
}

function main() {
  var argv = process.argv;

  logger.init();
  logger = logger.forFile('test_cyberlockers.js');

  setupSignals();

  var cyberlockers = new Cyberlockers();
  var action = argv[2];

  if (action === 'knownDomains')
    cyberlockers.knownDomains(log);

  if (action === 'add') {
    cyberlockers.add(argv[3], log);
  }

  if (action === 'getDetails') {
    cyberlockers.getDetails(argv[3], log);
  }

  if (action === 'update') {
    var id = argv[3];
    var updates = JSON.parse(argv[4]);
    cyberlockers.update(id, updates, log);
  }

  if (action === 'remove') {
    var id = argv[3];
    cyberlockers.remove(id, log);
  }

  if (action === 'export') {
    var dir = argv[3];

    cyberlockers.list(function(err, cyberlockers) {
      if (err)
        return console.warn(err);

      console.log('Exporting %d cyberlockers', cyberlockers.length);
      cyberlockers.forEach(function(cyberlocker) {
        var filename = path.join(dir, cyberlocker.name.dasherize().toLowerCase() + '.json');
        var buffer = JSON.stringify(cyberlocker, null, '\t');
        console.log('Exporting %s', filename);
        fs.writeFileSync(filename, buffer);
      });
      process.exit();
    });
  }
}

main();