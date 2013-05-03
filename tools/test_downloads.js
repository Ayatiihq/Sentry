/*
 * test_jobs.js: tests the jobswrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  , sugar = require('sugar')
  ;

var Downloads = acquire('downloads')
  ;

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
  logger = logger.forFile('test_downloads.js');

  setupSignals();

  var downloads = new Downloads();
  var action = argv[2];
  var arg0 = argv[3]

  if (action === 'getFileMimeType')
    downloads.getFileMimeType(arg0, log);

  if (action === 'getInfringementDownloads')
    downloads.getInfringementDownloads(require(arg0), log);

  if (action === 'addLocalDirectory')
    downloads.addLocalDirectory(require(argv[3]), argv[4], argv[5], argv[6], log);
}

main();