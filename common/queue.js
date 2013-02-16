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
 * @param {string}    queueName   The name of the queue to wrap.
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
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn(err);
}

function messageIsValid(message) {
  return message && message.messageid && message.popreceipt;
}

//
// Public Methods
//

/**
 * Push a message to the end of the queue.
 *
 * @param {string|object}          message              The message to push to the queue. Objects are parsed into JSON automatically.
 * @param {object|function(err)}   optionsOrCallback    The message options, or the callback.
 * @param {function(err)}          callback             A callback to receive an error if the request fails.
 * @return {undefined}
 */
Queue.prototype.push = function(message, options, callback) {
  var self = this;
  
  if (!message) {
    callback(new Error('message cannot be null'));
    return;
  }

  if (!options) {
    callback = defaultCallback;
    options = {};

  } else if (Object.isFunction(options)) {
    callback = options;
    options = {};
  
  } else if (Object.isObject(options)) {
    callback = callback ? callback : defaultCallback;
  }

  message = JSON.stringify(message);
  self.queueService_.createMessage(self.queue_, message, options, callback);
}

/**
 * Pop a message off the queue.
 *
 * @param {int|function(err, message)}    [locktimeOrCallback]    Optional time to lock the message for processing.
 * @param {function(err, message)}        callback                A callback to receive the message. If the queue is empty, message will be null.
 * @return {undefined}
 */
Queue.prototype.pop = function(locktime, callback) {
  var self = this
    , options = {}
  
  if (typeof locktime === 'function' || !callback) {
    callback = locktime;
  } else {
    options.visibilitytimeout = locktime;
  }
  callback = callback ? callback : defaultCallback;

  self.queueService_.getMessages(self.queue_, options, function(err, messages) {
    var message = null;
    if (!err && messages.length) {
      message = messages[0];
      message.body = JSON.parse(message.messagetext);
    }
    callback(err, message);
  });
}

/**
 * Delete a message from the queue. 
 *
 * @param {object}                   message     The message object as produced by #pop.
 * @param {function(err, message)}   callback    A callback to receive the updated message object, this is now the valid object for deletions.
 * @return {undefined}
 */
Queue.prototype.delete = function(message, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!messageIsValid(message))
    return callback(new Error('Cannot remove message: is invalid'));

  self.queueService_.deleteMessage(self.queue_,
                                   message.messageid,
                                   message.popreceipt,
                                   function(err, res) {
    if (!err) {
      message.popreceipt = res.popreceipt;
      message.timenextvisible = res.timenextvisible;
    }
    else {
      logger.warn('Unable to delete message %s: %s', message.messageid, err);
    }
    callback(err, message);
  });
}

/**
 * Peek at the message on the front of the queue.
 *
 * @param {function(err, message)}    callback    The callback to receive the peeked message.
 * @return {undefined}
 */
Queue.prototype.peek = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  self.queueService_.peekMessages(self.queue_, function(err, messages) {
    var message = null;
    if (!err && messages.length) {
      message = messages[0];
      message.body = JSON.parse(message.messagetext);
    }
    callback(err, message);
  });
}

/**
 * Extend the messages' visibility timeout if performing a long running task.
 *
 * @param {object}          message     The message object as produced by #pop.
 * @param {int}             locktime    The time, in seconds, to extend the lock by.
 * @param {function(err)}   callback    A callback to receive an error, if there is one.
 * @return {undefined}
 */
Queue.prototype.touch = function(message, locktime, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!messageIsValid(message))
    return callback(new Error('Cannot touch message: is invalid'));

  self.queueService_.updateMessage(self.queue_,
                                   message.messageid,
                                   message.popreceipt,
                                   locktime,
                                   function(err, res) {
    if (!err) {
      message.popreceipt = res.popreceipt;
      message.timenextvisible = res.timenextvisible;
    }
    else {
      logger.warn('Unable to touch message %s: %s', message.messageid, err);
    }
    callback(err, message);       
  });
}

/**
 * Get the approximate length of the queue.
 *
 * @param {function(err, length)}   callback    A callback to receive the queue length upon calculation.
 * @return {undefined}
 */
 Queue.prototype.length = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  self.queueService_.getQueueMetadata(self.queue_, function(err, queueInfo) {
    if (err) {
      callback(err);
    } else {
      callback(null, queueInfo.approximatemessagecount);
    }
  });
 }

 /**
  * Clear all messages from the queue.
  *
  * @param {function(err)}    callback    Called if there is an error.
  * @return {undefined}
  */
Queue.prototype.clear = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  self.queueService_.deleteMessage(self.queue_, callback);
}