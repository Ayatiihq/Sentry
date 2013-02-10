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

  self.tableService_ = azure.createTableService(config.AZURE_CORE_ACCOUNT,
                                                config.AZURE_CORE_KEY);
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
// Public Methods
//
/**
 * Get a list of active jobs for a campaign.
 *
 * @param  {string}               campagin     The campaign to search active jobs for.
 * @param  {function(err, roles)} callback     The callback to consume the jobs.
 * @return {undefined}
 */
Jobs.prototype.listActiveJobs = function(campaign, callback) {
  var self = this
    , partition = self.getPartitionKey(campaign)
    , then = Date.utc.create('6 hours ago').getTime()
    ;

  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select('PartitionKey, RowKey, scraper, created, started, finished, state')
                              .from(TABLE)
                              .where('PartitionKey eq ?', partition)
                              .and('created gt ?', then);
  self.tableService_.queryEntities(query, self.unpack.bind(self, callback));
}

/**
 * Get details of a job.
 *
 * @param  {string}                campaign    The campaign the job belongs to.
 * @param  {string}                jobUID      The uid of the Job.
 * @param  {function(err, job)}    callback    The callback to receive the details, or the error.
 * @return {undefined}
 */
Jobs.prototype.getDetails = function(campaign, jobUID, callback) {
  var self = this
    , partition = self.getPartitionKey(campaign)
    ;

  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select()
                              .from(TABLE)
                              .where('PartitionKey eq ?', partition)
                              .and('RowKey eq ?', jobUID);
  self.tableService_.queryEntities(query, self.unpackOne.bind(self, callback));
}


/**
 * Add a new job to the table.
 *
 * @param  {string}          campaign    The campaign the job belongs to.
 * @param  {object}          job         The job to add.
 * @param  {function(err)}   callback    A callback to handle errors.
 * @return {string}         uid         The UID generated for the job.
 */
Jobs.prototype.add = function(campaign, job, callback) {
  var self = this
    , partition = self.getPartitionKey(campaign)
    ;

  callback = callback ? callback : defaultCallback;

  if (!(job && job.consumer)) {
    return callback(new Error('job should be valid and have a consumer'));
  }
  
  job = self.pack(job);
  job.PartitionKey = partition;
  job.RowKey = self.genJobKey(job.consumer);
  job.created = Date.utc.create().getTime();
  job.started = -1;
  job.finished = -1;
  job.state = ifUndefined(job.state, states.jobs.state.QUEUED);

  self.tableService_.insertEntity(TABLE, job, callback);
}

/**
 * Starts a job.
 *
 * @param  {string}          campaign   The campaign the job belongs to.
 * @param  {string}          jobUID     The job uid.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.start = function(campaign, jobUID, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  var job = {};
  job.PartitionKey = self.getPartitionKey(campaign);
  job.RowKey = jobUID;
  job.started = Date.utc.create().getTime();
  job.state = states.jobs.state.STARTED;
  job.worker = Swarm.getUID();

  self.tableService_.mergeEntity(TABLE, job, callback);
}

/**
 * Pauses a job.
 *
 * @param  {string}          campaign   The campaign the job belongs to.
 * @param  {string}          jobUID     The job uid.
 * @param  {string}          snapshot   A snapshot of the job's current state, for resuming.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.pause = function(campaign, jobUID, snapshot, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  var job = {};
  job.PartitionKey = self.getPartitionKey(campaign);
  job.RowKey = jobUID;
  job.state = states.jobs.state.PAUSED;
  job.paused = Date.utc.create().getTime();
  job.snapshot = JSON.stringify(snapshot);

  self.tableService_.mergeEntity(TABLE, job, callback);
}

/**
 * Complete a job.
 *
 * @param  {string}          campaign   The campaign the job belongs to.
 * @param  {string}          jobUID     The job uid.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.complete = function(campaign, jobUID, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  var job = {};
  job.PartitionKey = self.getPartitionKey(campaign);
  job.RowKey = jobUID;
  job.state = states.jobs.state.COMPLETED;
  job.finished = Date.utc.create().getTime();

  self.tableService_.mergeEntity(TABLE, job, callback);
}

/**
 * Close a job due to a reason.
 *
 * @param  {string}          campaign   The campaign the job belongs to.
 * @param  {string}          jobUID     The job uid.
 * @param  {int}             state      The state the job should be closed in. 
 * @param  {string}          reason     The reason why the job was closed.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.close = function(campaign, jobUID, state, reason, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  var job = {};
  job.PartitionKey = self.getPartitionKey(campaign);
  job.RowKey = jobUID;
  job.state = state;
  job.reason = reason;
  job.finished = Date.utc.create().getTime();

  self.tableService_.mergeEntity(TABLE, job, callback);
}

/**
 * Close a job due to a reason.
 *
 * @param  {string}          campaign   The campaign the job belongs to.
 * @param  {string}          jobUID     The job uid.
 * @param  {object}          metadata   The new metadata.
 * @param  {function(err)}   callback   A The callback to handle errors.
 * @return {undefined}
 */
Jobs.prototype.setMetadata = function(campaign, jobUID, metadata, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  var job = {};
  job.PartitionKey = self.getPartitionKey(campaign);
  job.RowKey = jobUID;
  job.metadata = JSON.stringify(metadata);

  self.tableService_.mergeEntity(TABLE, job, callback);
}