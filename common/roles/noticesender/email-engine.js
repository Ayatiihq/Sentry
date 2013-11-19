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

var EmailEngine = module.exports = function() {
  this.sendgrid_ = null;
  this.init();
}

util.inherits(EmailEngine, events.EventEmitter);

EmailEngine.prototype.init = function() {
  var self = this;

  self.sendgrid_ = new SendGrid(config.SENDGRID_USER, config.SENDGRID_KEY);
}

EmailEngine.prototype.post = function(host, message, notice, done) {
  var self = this
    , details = host.noticeDetails
    , subject = 'DMCA & EUCD Notice of Copyright Infringements'
    ;

  if (details.manual)
    subject = 'TODO: ' + subject;

  self.sendgrid_.send({
    to: details.metadata.to,
    from: 'neilpatel@ayatii.com',
    fromname: 'Neil Patel',
    bcc: ['neilpatel@ayatii.com'],
    subject: subject,
    text: message,
    replyto: 'neilpatel@ayatii.com',
    date: new Date()
  },
  function(success, msg) {
    if (!success && msg.startsWith('Invalid JSON response')) {
      logger.warn('Didn\'t get a valid response from the SendGrid servers, but normally email still get\'s through');
      done(null, notice);
    }
    else
      done(success ? null :msg, notice, details.metadata.to);
  });
}

EmailEngine.canHandleHost = function (host) {
  if (!Object.has(host, 'noticeDetails')) { return false; }
  return (host.noticeDetails.type === 'email');
}
