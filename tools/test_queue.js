/*
 * test_queue.js: tests the queue wrapper
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger')
  ;

var Queue = acquire('queue');

function setupSignals() {
  process.on('SIGINT', function() {
    process.exit(1);
  });
}

function main() {
  logger.init();
  logger = logger.forFile('test_queue.js');

  setupSignals();

  var queue = new Queue("test-queue2");
  queue.push({ id: 'foobar', message: 'This was an object' });
  
  console.log('Waiting for request to finish');

  setTimeout(function() {

    queue.length(function(err, length) {
      console.log('Length: ', err ? err : length);
    });

    queue.peek(function(err, message) {
      if (err)
        console.warn('Peek: ', err);
      else
        console.log('Peek: ', message);
    });
    
    queue.pop(function(err, message) {
      if (err)
        console.warn('Pop: ', err);
      else
        console.log('Pop: ', message);

      queue.touch(message, 60 * 2, function(err, m) {
        if (err) {
          console.warn(err);
        } else {
          message = m;
        }
      });

      setTimeout(function() {
        console.log('Deleting message: ', message);
        queue.delete(message);
      }, 1000 * 60);
    });
  }, 1000 * 5);
}

main(); 
