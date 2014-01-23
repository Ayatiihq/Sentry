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

  setInterval(self.iterateClients.bind(self), config.STANDARD_CHECK_INTERVAL_MINUTES * 60 * 1000);
  
  self.roles_.on('ready', self.iterateClients.bind(self));
}


StandardDispatcher.prototype.iterateClients = function() {
  var self = this
    , prioritised = []
  ;

  self.clients_.listPriorityClients(function(err, clients) {
    if (err)
     return logger.warn(err);
    
    Seq(clients)
      .seqEach(function(client){
        var that = this;
        self.prioritiseCampaigns(client, function(err, result){
          if(err)
            return that(err);
          prioritised.push(result);
          that();
        });
      })
      .seq(function(){
        logger.info('Work lined up for the roles : ' + JSON.stringify(prioritised));
      })
      .catch(function(err){
        logger.warn(err);
      })
      ;
  });
}

StandardDispatcher.prototype.prioritiseCampaigns = function(client, done) {
  var self = this
  ;

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

      /*  campaigns.forEach(self.preCheckRoles.bind(self));
    });
  }
}
*/
StandardDispatcher.prototype.preCheckRoles = function(campaign) {
  var self = this;
  
  self.clients_.get(campaign.client, function(err, client){
    if(err)
      return logger.warn('Error retrieving Client from campaign ' + campaign.name);
    self.checkRoles(campaign, client);
  })
}

StandardDispatcher.prototype.checkRoles = function(campaign, client) {
  var self = this;

  self.roles_.getRoles().forEach(function(role) { 
    if (role.dispatcher)
      return;

    var jobsQuantity = role.jobsDecision(campaign, client);

  });
}


StandardDispatcher.prototype.createJob = function(campaign, jobs, role, consumer) {
  var self = this;

  jobs.push(campaign._id, consumer, {}, function(err, id) {
    if (err)
      logger.warn('Unable to create job for %j: %s: %s', campaign._id, consumer, err);
    else
      logger.info('Created job for %j: %s', campaign._id, id);
  });
}
