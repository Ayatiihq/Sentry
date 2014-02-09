/*
 * hadouken.js: the Hadouken feeder
 *
 * (C) 2014 Ayatii Limited
 *
 * Identifies recently verified torrents for a given campaign and hands them to hadouken
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')  
  , events = require('events')
  , fmt = require('util').format
  , logger = acquire('logger').forFile('hadouken.js')
  , request = require('request')
  , states = acquire('states')
  , sugar = require('sugar')
  , util = require('util')  
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Jobs = acquire('jobs')
  , Infringements = acquire('infringements')
  , Role = acquire('role')
  , Seq = require('seq')
  , URI = require('URIjs')
  ;

var PROCESSOR   = 'hadouken';
var MAXTIMEOUT  = 10000;

var Hadouken = module.exports = function() {
  this.campaign_ = null;
  this.campaigns_ = null;
  this.infringements_ = null;
  this.jobs_ = null;
  this.started_ = 0;
  this.touchId_ = 0;

  this.init();
}

util.inherits(Hadouken, Role);

Hadouken.prototype.init = function() {
  var self = this;
  self.cachedCalls_ = [];

  database.connectAndEnsureCollection("infringements", function(err, db, coll) {
    if (err)
      return logger.error('Unable to connect to database %s', err);
    self.db_ = db;
    self.infringements_ = coll;
    self.campaigns_ = new Campaigns();
    self.jobs_ = new Jobs('hadouken');
    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

Hadouken.prototype.processJob = function(err, job) {
  var self = this;

  if (err) {
    self.emit('error', err);
    return;
  } else if (!job) {
    logger.info('No job to process');
    self.emit('finished');
    return;
  }

  // Keep job alive
  self.touchId_ = setInterval(function() {
    self.jobs_.touch(job);
  }, config.STANDARD_JOB_TIMEOUT_MINUTES * 60 * 1000);

  // Error out nicely, closing the job too
  function onError(err) {
    logger.warn('Unable to process job: %s', err);
    logger.warn(err.stack, console.trace());
    self.jobs_.close(job, states.jobs.state.ERRORED, err);
    self.emit('error', err);
  }
  process.on('uncaughtException', onError);

  self.jobs_.start(job);

  Seq()
    .seq(function(){
      self.job_ = job;
      self.hadoukening(this);        
    })
    .seq(function(){
      self.jobs_.complete(job);
      clearInterval(self.touchId_);
      self.emit('finished');
    })
    .catch(function(err) {
      logger.warn('Unable to process job %j: %s', job, err);
      self.jobs_.close(job, states.jobs.state.ERRORED, err);
      clearInterval(self.touchId_);
      self.emit('error', err);
    })
    ;
}

Hadouken.prototype.hadoukening = function(done){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.hadoukening, Object.values(arguments)]);
  
  Seq()
    .seq(function() {
      self.campaigns_.getDetails(self.job_._id.owner, this);
    })
    .seq(function(campaign) {
      self.campaign_ = campaign;
      this();
    })
    .seq(function() {
      self.findTorrentsToMonitor(this);
    })
    .seq(function(ourPrey){
      self.goMonitor(ourPrey, this);
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Hadouken.prototype.findTorrentsToMonitor = function(done){
  var self = this
    , magnets = []
    ; 

  Seq()
    .seq(function(){
      self.infringements_.find({campaign: self.campaign_._id,
                                scheme: 'torrent',
                                'children.count': 0,
                                state: { $in: [1, 3, 4]}}).toArray(this);
    })
    .seq(function(results){
      results.each(function(result){
        var potentials = result.parents.uris.filter(function(uri){
          try{
            var uriO = URI(uri);
            return uriO.protocol() === 'magnet';
          }
          catch(err){
            return false;
          }
        });
        // do we want to add them all ? 
        // for now just picking random ones from the filtered list.
        magnets = magnets.union(potentials);
      });
      done(null, magnets);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Hadouken.prototype.goMonitor = function(ourPrey, done){
  var self = this;
  
  logger.info('monitor : \n' + JSON.stringify(ourPrey));

  Seq(ourPrey.slice(0,50))
    .seq(function(magnetLink){
      setTimeout(self.monitorOne.bind(self, magnetLink, this), 2000);
    })
    .seq(function(){
      logger.info('finished pushing to hadouken');
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

Hadouken.prototype.monitorOne = function(uri, done){
  var self = this;
  var data = {magnet: uri, campaign: self.campaign_._id};
  var api = config.HADOUKEN_ADDRESS + ':' + config.HADOUKEN_PORT + '/addmagnet';

  request.post({'url' : api,
                'timeout': MAXTIMEOUT,
                'headers' : {'content-type': 'application/json' , 'accept': 'text/plain'},
                'body': JSON.stringify(data)},
                function(err, resp, body){
                  if(err)
                    return done(err);                  
                  if(resp.statusCode !== 200){
                    return done(new Error('Did not get a 200 from hadouken, instead ' + resp.statusCode));
                  }
                  done();
                });
}

//
// Overrides
//
Hadouken.prototype.getName = function() {
  return "hadouken";
}

Hadouken.prototype.start = function() {
  var self = this;

  self.started_ = Date.create();
  self.jobs_.pop(self.processJob.bind(self));
  
  self.emit('started');
}

Hadouken.prototype.end = function() {
  var self = this;

  self.started_ = false;
}

// Testing
if (require.main == module) {
  var campaign = require(process.argv[2])
      hadouken = new Hadouken()
    ;

  hadouken.job_ = {};
  hadouken.job_._id = {owner : campaign._id};

  hadouken.hadoukening(function(err){
    if(err)
      return logger.info('err ' + err);
    logger.info('finished without errors');
  });
}
