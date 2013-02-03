/*
 * lock.js: acquire a system-wide lock on an entity.
 *
 * We use uniquely named queues to acquire locks on resources. Queues that exist
 * and have a size > 1 mean that there is a lock in progress. A message on the
 * queue as a timeout value, and hence if the lock owner no longer exists, the
 * queue will become empty in time.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('lock.js')
  , os = require('os')
  , seq = require('parseq').seq
  , sugar = require('sugar')
  , util = require('util')
  ;

var LOCK_TABLE = "locks";

var Lock = module.exports = function() {
  var tableService_ = null;

  this.init();
}

Lock.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.tableService_.createTableIfNotExists(LOCK_TABLE, function(err) {
    if (err)
      console.warn(err);
  });
}

Lock.prototype.tryTakeLock = function(domain, lockname, ttl, callback) {
  var self = this;

  self.tableService_.deleteEntity(LOCK_TABLE,
                                  { PartitionKey: domain, RowKey: lockname },
                                  function(err) {
    if (err) {
      logger.warn(util.format('Unable to delete %s,%s: %s', domain, lockname, err));
      callback(null);
    } else {
      self.createAndCheckLock(domain, lockname, ttl, callback);
    }
  });
}

Lock.prototype.createAndCheckLock = function(domain, lockname, ttl, callback) {
  var self = this;
  var task = {
    PartitionKey: domain,
    RowKey: lockname,
    expires: Date.create(ttl + 'seconds from now'),
    ownerId: self.getOwnerId(domain, lockname)
  };

  self.tableService_.insertEntity(LOCK_TABLE, task, function (err) {
    if (err) {
      callback(null);
    } else {
      self.tableService_.queryEntity(LOCK_TABLE, domain, lockname, function(err, entity) {
        if (err) {
          callback(null);
        } else {
          console.log(task.expires == entity.expires);
          callback(task.expires == entity.expires ? entity : null);
        }
      });
    }
  });
}

Lock.prototype.getOwnerId = function(domain, lockname) {
  return util.format('%s/%s/%s/%s', os.hostname(), process.pid, domain, lockname);
}

Lock.prototype.tokenIsValid = function(token) {
  return token && token.PartitionKey && token.RowKey && token.expires && token.ownerId;
}

//
// Public Methods
//

/**
 * Tries to grab a system-wide lock on domain:lockname.
 *
 * @param {string}  domain                  A domain for this lock, to avoid nameing conflicts.
 * @param {string}  lockname                The name of the resource that is being locked.
 * @param {integer} ttl                     The length to keep the lock, in seconds.
 * @param {function(token)} callback        The callback function, @token is null if lock fails.
 * @return {undefined}
 */
Lock.prototype.tryLock = function(domain, lockname, ttl, callback) {
  var self = this;

  self.tableService_.queryEntity(LOCK_TABLE, domain, lockname, function(err, entity) {
    if (err) {
      self.createAndCheckLock(domain, lockname, ttl, callback);
    } else {
      var then = Date.create(entity.expires);

      if (then.isBefore(ttl + ' seconds ago')) {
        self.tryTakeLock(domain, lockname, ttl, callback);
      } else {
        callback(null);
      }
    }
  });
}

/**
 * Tries to extend a lock, returns err if lock no longer belongs to the caller.
 *
 * @param {object} token           The token that was passed to the owner upon successful locking.
 * @param {integer} ttl            The length to keep the lock, in seconds. 
 * @param {function(err)} callback The callback, err is valid if the lock is no longer the callers.
 * @return {undefined}
 */
Lock.prototype.extendLock = function(token, ttl, callback) {
  var self = this;

  if (!self.tokenIsValid(token)) {
    callback(new Error('Invalid token'));
    return;
  }

  self.tableService_.queryEntity(LOCK_TABLE, token.PartitionKey, token.RowKey, function(err, entity) {
    if (entity.ownerId === token.ownerId) {
      token.expires = Date.create(ttl + 'seconds from now');

      self.tableService_.updateEntity(LOCK_TABLE, token, function(err) {
        callback(err);
      });

    } else {
      callback(new Error('Lock no longer belongs to owner. New owner: ' + entity.ownerId))
    }
  });
}

/**
 * Tries to remove a pre-existing lock that the caller owns.
 *
 * @param {object} token The token that was passed to the owner upon successful locking.
 * @return {undefined}
 */
Lock.prototype.removeLock = function(token) {
  var self = this;

  if (!self.tokenIsValid(token)) {
    logger.warn('Unable to remove lock, token is invalid: ' + token);
    return;
  }

  self.tableService_.queryEntity(LOCK_TABLE, token.PartitionKey, token.RowKey, function(err, entity) {
    if (entity.ownerId === token.ownerId) {
      self.tableService_.deleteEntity(LOCK_TABLE, token, function(err) {
        if (err)
          logger.warn('Unable to remove lock: ' + err);
        else
          logger.info('Successfully removed lock ' + token.ownerId);
      });
    } else {
      logger.info('Ignoring removeLock request, lock is has other owner: ' + entity.ownerId);
    }
  });
}