/*
 * queue.js: wraps a remote queue.
 *
 * Represents a remote queue.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('queue.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

/**
 * Wraps a remote queue.
 * 
 * @param {string} queueName The name of the queue to wrap.
 * @return {object}
 */
var Queue = module.exports = function(queueName) {
  this.queueService_ = null;
  this.queue_ = queueName;

  this.init();
}

Queue.prototype.init = function() {
  var self = this;

  self.queueService_ = azure.createQueueService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.queueService_.createQueueIfNotExists(self.queue_, function(err) {
    if (err)
      console.warn(err);
  });
}

//
// Public Methods
//
