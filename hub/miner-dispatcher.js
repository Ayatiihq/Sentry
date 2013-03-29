/*
 * miner-dispatcher.js: the miner-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches Miner jobs
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('miner-dispatcher.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Queue = acquire('queue')
  , Campaigns = acquire('campaigns');

var MinerDispatcher = module.exports = function() {
  this.queue_ = null;

  this.init();
}

util.inherits(MinerDispatcher, events.EventEmitter);

MinerDispatcher.prototype.init = function() {
  var self = this;

  self.queue_ = new Queue('miner');

  setTimeout(self.checkExistingJob.bind(self), config.MINER_CHECK_INTERVAL_MINUTES * 60 * 1000);
  self.checkExistingJob();
}

MinerDispatcher.prototype.checkExistingJob = function() {
  var self = this;

  self.queue_.length(function(err, length) {
    length = length ? length : 0;
    if (!length) {
      self.createMinerJob();
    } else {
      logger.info('Existing job exists');
    }
  });
}

// Add job to database
// Add job to queue
MinerDispatcher.prototype.createMinerJob = function() {
  var self = this;

  logger.info('Creating job');
  var opts = {};
  opts.messagettl = config.MINER_JOB_EXPIRES_SECONDS;

  var msg = {};
  msg.created = Date.utc.create().getTime();

  self.queue_.push(msg, opts, function(err) {
    if (err) {
      logger.warn('Unable to insert message %s: %s', msg, err);
      self.queue_.close(uid, states.jobs.state.ERRRORED, err);
    } else {
      logger.info('Job successfully created');
    }
  });
}