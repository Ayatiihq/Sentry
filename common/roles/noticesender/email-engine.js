/*
 * email-engine.js: the email-engine
 *
 * (C) 2012 Ayatii Limited
 *
 * EmailEngine processes the results of spider crawls and converts (mines) them into
 * infringements for a specific campaign.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('email-engine.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq')

var EmailEngine = module.exports = function(campaign, host, infringements) {
  this.campaign_ = campaign;
  this.host_ = host;
  this.infringements_ = infringements;

  this.init();
}

util.inherits(EmailEngine, events.EventEmitter);

EmailEngine.prototype.init = function() {
  var self = this;
}

EmailEngine.prototype.goPostal = function(done) {
  var self = this
     , campaign = self.campaign_
     , host = self.host_
     , details = host.noticeDetails
     , infringements = self.infringements_
     ;

  self.done_ = done;

  var notice = {
    engine: 'email',
    infringements: [],
    metadata: {},
    message: {
      to: details.to,
      body: "Booyaa"
    }
  };

  self.emit('notice', notice);
  done();
}