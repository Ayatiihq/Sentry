/*
 * jobs.js: the jobs table
 *
 * Wraps the jobs table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('jobs.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var COLLECTION = 'jobs';

/**
 * Wraps the jobs table.
 * 
 * @param {string}    role     Role of the job (scraper, spider, etc)
 * @return {object}
 */
var Jobs = module.exports = function(role) {
  this.role_ = role;
  this.jobs_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Jobs.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.jobs_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}

//
// Azure can't do 'distinct', so there might be duplicate jobs, and hence we
// must flatten them into just the most recent. Results come back as 
//
Jobs.prototype.flatten = function(callback, err, jobs) {
  var self = this
    , hash = {}
    ;

  if (err) {
    return callback(err);
  }

  jobs.forEach(function(job) {
    hash[JSON.stringify(job._id.consumer)] = job;
  });

  callback(err, Object.values(hash), hash);
}

//
// Public Methods
//
/**
 * Get a list of active jobs for a domain.
 *
 * @param  {stringOrObject}              owner        Who owns the job.
 * @param  {function(err, jobs, mapped)} callback     The callback to consume the jobs and a mapped version of the jobs.
 * @return {undefined}
 */
Jobs.prototype.listActiveJobs = function(owner, callback) {
  var self = this
    , then = Date.utc.create('6 hours ago').getTime()
    ;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.listActiveJobs, Object.values(arguments)]);

  var query = {
    '_id.owner': owner,
    '_id.role': self.role_,
    '_id.created': { $gt: then }
  };

  self.jobs_.find(query).sort({ created: 1 }).toArray(self.flatten.bind(self, callback));
}

/**
 * Get details of a job.
 *
 * @param  {string}                jobId     The uid of the Job.
 * @param  {function(err, job)}    callback  The callback to receive the details, or the error.
 * @return {undefined}
 */
Jobs.prototype.getDetails = function(jobId, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;
  jobId = Object.isString(jobId) ? JSON.parse(jobId) : jobId;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.getDetails, Object.values(arguments)]);

  self.jobs_.findOne({ _id: jobId}, callback);
}

/**
 * Add a new job to the table.
 *
 * @param  {stringOrObject}    owner       Who owns the job.
 * @param  {string}            consumer    The consumer of the job.
 * @param  {object}            metadata    The job's metadata.
 * @param  {function(err,uid)} callback    A callback receive the uid.
 * @return {string}            uid         The UID generated for the job.
 */
Jobs.prototype.add = function(owner, consumer, metadata, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  var job = {};
  job._id = {
    owner: owner,
    role: self.role_,
    consumer: consumer,
    created: Date.now()
  };
  job.started = 0;
  job.finished = 0;
  job.state = ifUndefined(job.state, states.jobs.state.QUEUED);
  job.reason = '';  
  job.snapshot = {};
  job.metadata = ifUndefined(metadata, {});

  self.jobs_.insert(job, function(err) {
    callback(err, err ? undefined : JSON.stringify(job._id));
  });
}

/**
 * Starts a job.
 *
 * @param  {object}          job        The job.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.start = function(job, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.start, Object.values(arguments)]);

  var updates = {
    $set: {
      started: Date.now(),
      state: states.jobs.state.STARTED,
      worker: utilities.getWorkerId()
    }
  };

  self.jobs_.update({ _id: job._id }, updates, callback);
}

/**
 * Pauses a job.
 *
 * @param  {object}          job        The job.
 * @param  {string}          snapshot   A snapshot of the job's current state, for resuming.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.pause = function(job, snapshot, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.pause, Object.values(arguments)]);

  var updates = {
    $set: {
      paused: Date.now(),
      state: states.jobs.state.PAUSED,
      snapshot: snapshot
    }
  };
  self.jobs_.update({ _id: job._id }, updates, callback);
}

/**
 * Complete a job.
 *
 * @param  {object}          job        The job.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.complete = function(job, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.complete, Object.values(arguments)]);

  var updates = {
    $set: {
      finished: Date.now(),
      state: states.jobs.state.COMPLETED
    }
  };
  self.jobs_.update({ _id: job._id }, updates, callback);
}

/**
 * Close a job due to a reason.
 *
 * @param  {object}          job        The job.
 * @param  {int}             state      The state the job should be closed in. 
 * @param  {string}          reason     The reason why the job was closed.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.close = function(job, state, reason, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.close, Object.values(arguments)]);

  var updates = {
    $set: {
      finished: Date.now(),
      state: state,
      log: reason
    }
  };
  self.jobs_.update({ _id: job._id }, updates, callback);
}

/**
 * Close a job due to a reason.
 *
 * @param  {object}          job        The job.
 * @param  {object}          metadata   The new metadata.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.setMetadata = function(job, metadata, callback) {
  var self = this;

  callback = callback ? callback : defaultCallback;

  if (!self.jobs_)
    return self.cachedCalls_.push([self.complete, Object.values(arguments)]);

  var updates = {
    $set: {
      metadata: metadata
    }
  };
  self.jobs_.update({ _id: job._id }, updates, callback);
}