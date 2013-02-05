/*
 * test_lock.js: test Lock
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var Lock = acquire('lock');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  logger.init();
  logger = logger.forFile('test_lock.js');

  setupSignals();

  var lock = new Lock();

  lock.tryLock('test', 'test', 10, function(token) {
    logger.info(token);

    setTimeout(function() {
      if (token)
        lock.extendLock(token, 60, function(err) {
          console.log('Extending lock: ' + err);
        });
    }, 2000);

    setTimeout(function() {
      if (token)
        lock.removeLock(token);
    }, 4000);
  });
}

main(); 
