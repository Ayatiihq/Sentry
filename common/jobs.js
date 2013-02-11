/*
 * jobs.js: the jobs table
 *
 * Wraps the jobs table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , crypto = require('crypto')
  , logger = acquire('logger').forFile('jobs.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  ;

var Swarm = acquire('swarm');

var TABLE = 'jobs'
  , PACK_LIST = ['metadata', 'snapshot']
  ;

/**
 * Wraps the jobs table.
 * 
 * @param {string}    jobType     Type of job (scraper, spider, etc)
 * @return {object}
 */
var Jobs = module.exports = function(jobType) {
  this.tableService_ = null;
  this.type_ = jobType;

  this.init();
}

Jobs.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}

Jobs.prototype.genJobKey = function(name) {
  return name + '.' + Date.utc.create().getTime();
}

Jobs.prototype.getPartitionKey = function(name) {
  var self = this;
  return name + '.' + self.type_;
}

Jobs.prototype.pack = function(job) {
  PACK_LIST.forEach(function(key) {
    if (job[key])
      job[key] = JSON.stringify(job[key]);
  });

  return job;
}

Jobs.prototype.unpackOne = function(callback, err, job) {
  if (err) {
    callback(err);
    return;
  }

  PACK_LIST.forEach(function(key) {
    if (job[key])
      job[key] = JSON.parse(job[key]);
  });
  
  callback(err, job);
}

Jobs.prototype.unpack = function(callback, err, list) {
  var self = this;

  if (err) {
    callback(err);
    return;
  }

  list.forEach(function(job) {
    PACK_LIST.forEach(function(key) {
      if (job[key])
        job[key] = JSON.parse(job[key]);
    });
  });

  callback(err, list);
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
    callback(err);
    return;
  }

  jobs.forEach(function(job) {
    hash[job.consumer] = job;
  });

  callback(err, Object.values(hash), hash);
}

//
// Public Methods
//
/**
 * Get a list of active jobs for a campaign.
 *
 * @param  {stringOrObject}              campaign     The campaign to search active jobs for.
 * @param  {function(err, jobs, mapped)} callback     The callback to consume the jobs and a mapped version of the jobs.
 * @return {undefined}
 */
Jobs.prototype.listActiveJobs = function(campaign, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , partition = self.getPartitionKey(campaign)
    , then = Date.utc.create('6 hours ago').getTime()
    ;

  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select('PartitionKey, RowKey, consumer, scraper, created, started, finished, state')
                              .from(TABLE)
                              .where('PartitionKey eq ?', partition)
                              .and('created gt ?', then);
  self.tableService_.queryEntities(query, self.unpack.bind(self, self.flatten.bind(self, callback)));
}

/**
 * Get details of a job.
 *
 * @param  {stringOrObject}        campaign    The campaign the job belongs to.
 * @param  {string}                job      The uid of the Job.
 * @param  {function(err, job)}    callback    The callback to receive the details, or the error.
 * @return {undefined}
 */
Jobs.prototype.getDetails = function(campaign, job, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , job = Object.isString(job) ? job : job.RowKey
    , partition = self.getPartitionKey(campaign)
    ;

  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select()
                              .from(TABLE)
                              .where('PartitionKey eq ?', partition)
                              .and('RowKey eq ?', job);
  self.tableService_.queryEntities(query, self.unpack.bind(self, function(err, list) {
    callback(err, list ? list[0] : list)
  }));
}


/**
 * Add a new job to the table.
 *
 * @param  {stringOrObject}    campaign    The campaign the job belongs to.
 * @param  {object}            job         The job to add.
 * @param  {function(err,uid)} callback    A callback receive the uid.
 * @return {string}            uid         The UID generated for the job.
 */
Jobs.prototype.add = function(campaign, job, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , partition = self.getPartitionKey(campaign)
    ;

  callback = callback ? callback : defaultCallback;

  if (!(job && job.consumer)) {
    return callback(new Error('job should be valid and have a consumer'));
  }
  
  job.PartitionKey = partition;
  job.RowKey = self.genJobKey(job.consumer);
  job.created = Date.utc.create().getTime();
  job.started = -1;
  job.finished = -1;
  job.state = ifUndefined(job.state, states.jobs.state.QUEUED);
  job.reason = '';
  job.snapshot = {};
  job.metadata = {};
  job = self.pack(job);

  self.tableService_.insertEntity(TABLE, job, function(err) {
    callback(err, job.RowKey);
  });

  return job.RowKey;
}

/**
 * Starts a job.
 *
 * @param  {stringOrObject}  campaign   The campaign the job belongs to.
 * @param  {stringOrObject}  job        The job.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.start = function(campaign, job, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , job = Object.isString(job) ? job : job.RowKey
    ;

  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity.PartitionKey = self.getPartitionKey(campaign);
  entity.RowKey = job;
  entity.started = Date.utc.create().getTime();
  entity.state = states.jobs.state.STARTED;
  entity.worker = Swarm.getUID();

  self.tableService_.mergeEntity(TABLE, entity, callback);
}

/**
 * Pauses a job.
 *
 * @param  {stringOrObject}  campaign   The campaign the job belongs to.
 * @param  {stringOrObject}  job        The job.
 * @param  {string}          snapshot   A snapshot of the job's current state, for resuming.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.pause = function(campaign, job, snapshot, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , job = Object.isString(job) ? job : job.RowKey
    ;

  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity.PartitionKey = self.getPartitionKey(campaign);
  entity.RowKey = job;
  entity.state = states.jobs.state.PAUSED;
  entity.paused = Date.utc.create().getTime();
  entity.snapshot = JSON.stringify(snapshot);

  self.tableService_.mergeEntity(TABLE, entity, callback);
}

/**
 * Complete a job.
 *
 * @param  {stringOrObject}  campaign   The campaign the job belongs to.
 * @param  {stringOrObject}  job        The job.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.complete = function(campaign, job, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , job = Object.isString(job) ? job : job.RowKey
    ;

  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity.PartitionKey = self.getPartitionKey(campaign);
  entity.RowKey = job;
  entity.state = states.jobs.state.COMPLETED;
  entity.finished = Date.utc.create().getTime();

  self.tableService_.mergeEntity(TABLE, entity, callback);
}

/**
 * Close a job due to a reason.
 *
 * @param  {stringOrObject}  campaign   The campaign the job belongs to.
 * @param  {stringOrObject}  job        The job.
 * @param  {int}             state      The state the job should be closed in. 
 * @param  {string}          reason     The reason why the job was closed.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.close = function(campaign, job, state, reason, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , job = Object.isString(job) ? job : job.RowKey
    ;

  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity.PartitionKey = self.getPartitionKey(campaign);
  entity.RowKey = job;
  entity.state = state;
  entity.reason = reason;
  entity.finished = Date.utc.create().getTime();

  self.tableService_.mergeEntity(TABLE, entity, callback);
}

/**
 * Close a job due to a reason.
 *
 * @param  {stringOrObject}  campaign   The campaign the job belongs to.
 * @param  {stringOrObject}  job        The job.
 * @param  {object}          metadata   The new metadata.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.setMetadata = function(campaign, job, metadata, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , job = Object.isString(job) ? job : job.RowKey
    ;

  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity.PartitionKey = self.getPartitionKey(campaign);
  entity.RowKey = job;
  entity.metadata = JSON.stringify(metadata);

  self.tableService_.mergeEntity(TABLE, entity, callback);
}