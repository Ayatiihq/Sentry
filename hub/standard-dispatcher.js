/*
 * standard-dispatcher.js: the standard-dispatcher
 *
 * (C) 2012 Ayatii Limited
 *
 * Dispatches jobs for standard roles per-campaign
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('standard-dispatcher.js')
  , states = acquire('states').jobs.state
  , util = require('util')
  ;

var Campaigns = acquire('campaigns')
  , Clients = acquire('clients')
  , Jobs = acquire('jobs')
  , Roles = acquire('roles')
  , Seq = require('seq')
  ;

var StandardDispatcher = module.exports = function() {
  this.campaigns_ = null;
  this.roles_ = null;
  this.clients_ = null;

  this.init();
}

util.inherits(StandardDispatcher, events.EventEmitter);

StandardDispatcher.prototype.init = function() {
  var self = this;

  self.campaigns_ = new Campaigns();
  self.clients_ = new Clients();
  self.roles_ = new Roles();

  setInterval(self.findWork.bind(self), config.STANDARD_CHECK_INTERVAL_MINUTES * 60 * 1000);
  
  self.roles_.on('ready', self.findWork.bind(self));
}


StandardDispatcher.prototype.findWork = function() {
  var self = this
    , workToDo = []
  ;
  // in time filter on client 'account state' (0 => acive, 1 => suspended)
  self.clients_.listClients(function(err, clients) {
    if (err)
     return logger.warn(err);
    
    Seq(clients)
      .seqEach(function(client){
        var that = this;
        // temp
        if(client._id !== 'Forwind')
          return that();

        self.getClientCampaigns(client, function(err, result){
          if(err || !result)
            return that(err);
          workToDo.push(result);
          that();
        });
      })
      .seq(function(){
        this();
      })
      .set(workToDo)
      .seqEach(function(workItem){
        self.makeWork(workItem, this);
      })
      .seq(function(){
        logger.info('finished finding and making jobs.');
        this();
      })
      .catch(function(err){
        logger.warn(err);
      })
      ;
  });
}

StandardDispatcher.prototype.getClientCampaigns = function(client, done) {
  var self = this;

  self.campaigns_.listCampaignsForClient(client._id, function(err, campaigns) {
    if (err)
      return done(err);
    
    var activeCampaigns = campaigns.filter(function(campaign){return campaign.sweep});
    
    if(activeCampaigns.isEmpty())
      return done();

    var work = {'client' : client,
                'campaigns' : activeCampaigns.sort(function(a,b){return a.priority > b.priority})};

    done(null, work);     
  });
}  

StandardDispatcher.prototype.makeWork = function(workItem, done){
  var self = this;
  logger.info('Make work for client : ' + workItem.client._id +
              ' with ' + workItem.campaigns.length + ' campaigns');
  Seq(workItem.campaigns)
    .seqEach(function(campaign){
      self.makeJobs(campaign, workItem.client, this);
    })
    .seq(function(){
      logger.info('finished job creation');
      done();
    })
    .catch(function(err){
      logger.warn(err);
      done(err);
    })
    ;
}

StandardDispatcher.prototype.makeJobs = function(campaign, client, done) {
  var self = this;
  
  var rolesOfInterest = self.roles_.getRoles().filter(function(role){
    var supported = false;
    if (role.types) {
      Object.keys(role.types, function(type) {
        if (campaign.type.startsWith(type))
          supported = true;
      });
    }
    return !role.dispatcher && supported;
  });
  
  logger.info('rolesOfInterest ' +
              JSON.stringify(rolesOfInterest.map(function(role){return role.name})));

  Seq(rolesOfInterest)
    .seqEach(function(role){
      self.makeJobsForRole(campaign, client, role, this);
    })
    .seq(function(){
      logger.info('finished with campaign ' + campaign.name);
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

StandardDispatcher.prototype.makeJobsForRole = function(campaign, client, role, done) {
  var self = this
    , jobs = new Jobs(role.name)
    , roleInstance = null
  ;
  
  Seq()
    .seq(function(){
      self.doesRoleHaveJobs(role, campaign, jobs, this);
    })
    .seq(function(inProgress){
      if(inProgress){
        logger.info('looks like we dont need to create jobs for ' + role.name + ' on campaign ' + campaign.name);
        return done();
      }
      roleInstance = self.roles_.loadRole(role.name);
      if(!roleInstance)
        done(new Error('Failed to instantiate role instance'));
      
      var result = roleInstance.orderJobs(campaign, client, role.engines);
      this(null, result);
    })
    .seq(function(orders){
      self.createJobsFromOrders(orders, jobs, this);
    })
    .seq(function(){
      logger.info('makeWorkForRole "' + role.name + '" finished.');
      done();
    })
    .catch(function(err){
      logger.warn('Problems determining whether Role %s wants work ', role.name, campaign.name);
    })
    ;
}

StandardDispatcher.prototype.createJobsFromOrders = function(orders, jobs, done){
  var self = this;
  Seq(orders)
    .seqEach(function(order){
      logger.info('Create this job ' + JSON.stringify(order));
      this();
      //jobs.push(order.owner, order.consumer, order.metadata, this);
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

StandardDispatcher.prototype.doesRoleHaveJobs = function(role, campaign, jobs, done){
  var self = this;

  jobs.listActiveJobs(campaign._id, function(err, array, existingJobs) {
    if (err) {
      logger.warn('Unable to get active jobs for campaign %s, %s', consumer, err);
      return done(err);
    }

    // messy but handles the whole engine thing inline.
    var lastJobs = [];

    if(role.engines){
      role.engines.each(function(engine){
        if(existingJobs[getRoleConsumerId(role.name, engine)])
          lastJobs.push(existingJobs[getRoleConsumerId(role.name, engine)])
      });
    }
    else{
      lastJobs.push(existingJobs[role.name]);
    }

    if (!lastJobs){
      logger.info(' no jobs recently like this, go create ');
      return done(null, false);
    }
    
    // Just pick the one created last, the engine jobs run in tandem anyway.
    var lastJob = lastJobs.sortBy(function(job){ return job.created }).last();

    if (!lastJob){
      logger.info(' no jobs recently like this, go create ');
      return done(null, false);
    }

    switch(lastJob.state) {
      case states.QUEUED:
      case states.PAUSED:
        return done(null, true);

      case states.STARTED:
        if (role.longRunning)
          return done(null, true);
        
        var tooLong = Date.create(lastJob.popped).isBefore((config.STANDARD_JOB_TIMEOUT_MINUTES + 2 ) + ' minutes ago');
        if (tooLong)
          jobs.close(lastJob, states.ERRORED, new Error('Timed out'));
        return done(null, !tooLong); 

      case states.COMPLETED:
        var waitBeforeNextRun = role.intervalMinutes ? role.intervalMinutes : campaign.sweepIntervalMinutes;
        var waitedLongEnough = Date.create(lastJob.finished).isBefore(waitBeforeNextRun + ' minutes ago');
        done(null, !waitedLongEnough); 
    }
  });
}

function getRoleConsumerId(role, consumer) {
  if (role === consumer)
    return role;
  else
    return role + '.' + consumer;
}
