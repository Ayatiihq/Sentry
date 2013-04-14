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
  , utilities = acquire('utilities')
  ;

var Handlebars = require('handlebars')
  , Seq = require('seq')
  , Storage = acquire('storage')
  ;

var EmailEngine = module.exports = function(client, campaign, host, infringements) {
  this.client_ = client;
  this.campaign_ = campaign;
  this.host_ = host;
  this.infringements_ = infringements;
  this.storage_ = null;

  this.init();
}

util.inherits(EmailEngine, events.EventEmitter);

EmailEngine.prototype.init = function() {
  var self = this;

  self.storage_ = new Storage('notices');
}

EmailEngine.createHash = function() {
  return utilities.genLinkKey(JSON.stringify(self.campaign._id),
                              Date.now());
}

EmailEngine.prototype.goPostal = function(done) {
  var self = this
     , campaign = self.campaign_
     , host = self.host_
     , details = host.noticeDetails
     , template = null
     , message = null
     ;

  self.done_ = done;
  self.hash_ = createHash();

  Seq()
    .seq('getTemplate', function() {
      var name = util.format('%s.%s.template', details.metadata.template, campaign.type);
      self.storage_.getToText(name, {}, this);
    })
    .seq('prepareContext', function(template_) {
      template = template_;
      self.prepareContext(this);
    })
    .seq('compileTemplateToMessage', function(context) {
      try {
        template = Handlebars.compile(template);
        this(null, template(context));
      } catch (err) {
        this(err);
      }
    })
    .seq('sendMessage', function(message_) {
      message = message_;
      self.post(message, this);
    })
    .seq('prepareNoticeForDB', function(hash) {
      self.prepareNotice(message, this);
    })
    .seq('done', function(notice) {
      self.emit('notice', notice);
      done();
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

EmailEngine.prototype.prepareContext = function(done) {
  var self = this;

  switch (self.campaign_.type) {
    case 'music.album':
      self.prepareMusicAlbumContext(done);
      break;

    default:
      done(new Error('Type not supported: ' + self.campaign_.type));
  }
}

EmailEngine.prototype.prepareMusicAlbumContext = function(done) {
  var self = this;

  var context = {
    date: Date.utc.create().format('{dd} {Month} {yyyy}'),
    reference: self.hash_,
    client: self.client_,
    host: self.host_,
    campaign: self.campaign_,
    infringements: self.infringements_
  };

  done(null, context);
}

EmailEngine.prototype.post = function(message, done) {
  var self = this;

  console.log(message);
  done(null, '1');
}

EmailEngine.prototype.prepareNotice = function(message, done) {
  var self = this
    , notice = {}
    ;

  notice._id = self.hash_;
  notice.campaign = self.campaign_._id;
  notice.created = Date.now();
  notice.metadata = {};
  notice.message = {
    to: self.host_.noticeDetails.metadata.to,
    message: message
  };
  notice.infringements = [];

  self.infringements_.forEach(function(infringement) {
    notice.infringements.push(infringement._id);
  });

  done(null, notice);
}