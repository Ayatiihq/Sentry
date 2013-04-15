/*
 * email-engine.js: the email-engine
 *
 * (C) 2012 Ayatii Limited
 *
 * EmailEngine sends notices to hosts with email addresses.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('email-engine.js')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var SendGrid = require('sendgrid').SendGrid
  , Seq = require('seq')
  ;

var EmailEngine = module.exports = function(client, campaign, host, infringements, hash, message) {
  this.client_ = client;
  this.campaign_ = campaign;
  this.host_ = host;
  this.infringements_ = infringements;
  this.hash_ = hash;
  this.message_ = message;
  
  this.sendgrid_ = null;

  this.init();
}

util.inherits(EmailEngine, events.EventEmitter);

EmailEngine.prototype.init = function() {
  var self = this;

  self.sendgrid_ = new SendGrid(config.SENDGRID_USER, config.SENDGRID_KEY);
}

EmailEngine.prototype.post = function(done) {
  var self = this
    , details = self.host_.noticeDetails
    , notice = self.prepareNotice()
    ;

  self.sendgrid_.send({
    to: details.metadata.to,
    from: 'neilpatel@ayatii.com',
    fromname: 'Neil Patel',
    subject: 'DMCA & EUCD Notice of Copyright Infringements',
    text: self.message_,
    replyto: 'neilpatel@ayatii.com',
    date: new Date()
  },
  function(success, msg) {
    if (!success && msg.startsWith('Invalid JSON response')) {
      logger.warn('Didn\'t get a valid response from the SendGrid servers, but normally email still get\'s through');
      done(null, notice);
    }
    else
      done(success ? null :msg, notice);
  });
}

EmailEngine.prototype.prepareNotice = function() {
  var self = this
    , notice = {}
    ;

  notice._id = self.hash_;
  notice.metadata = {
    to: self.host_.noticeDetails.metadata.to
  };
  notice.infringements = [];

  self.infringements_.forEach(function(infringement) {
    notice.infringements.push(infringement._id);
  });

  return notice;
}