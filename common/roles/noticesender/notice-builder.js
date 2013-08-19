/*
 * notice-builder.js: the notice-builder
 *
 * (C) 2012 Ayatii Limited
 *
 * NoticeBuilder builds the notice depending on the host.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('notice-builder.js')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Handlebars = require('handlebars')
  , Seq = require('seq')
  , Storage = acquire('storage')
  ;

var NoticeBuilder = module.exports = function(client, campaign, host, infringements) {
  this.client_ = client;
  this.campaign_ = campaign;
  this.host_ = host;
  this.infringements_ = infringements;
  this.storage_ = null;

  this.init();
}

util.inherits(NoticeBuilder, events.EventEmitter);

NoticeBuilder.prototype.init = function() {
  var self = this;

  self.storage_ = new Storage('notices');
}

NoticeBuilder.prototype.createHash = function(escalate) {
  var self = this;
  var input = escalate ? JSON.stringify(self.campaign_._id) + '-escalate' : JSON.stringify(self.campaign_._id);
  return utilities.genLinkKey(input,
                              Date.now());
}

NoticeBuilder.prototype.build = function(done, escalate) {
  var self = this
     , campaign = self.campaign_
     , host = self.host_
     , details = host.noticeDetails
     , template = null
     , message = null
     ;

  self.done_ = done;
  self.hash_ = self.createHash(escalate);

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
    .seq('done', function(message) {
      self.storage_.createFromText(self.hash_, message, {}, function(err) {
        if (err) {
         logger.warn('Unable to save message, trying again: %s', err);
          self.storage_.createFromText(self.hash_, message, {}, logErr);
        }
        done(null, self.hash_, message);
      });
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

NoticeBuilder.prototype.prepareContext = function(done) {
  var self = this;

  switch (self.campaign_.type) {
    case 'music.album':
      self.prepareMusicAlbumContext(done);
      break;

    case 'movie':
      self.prepareMovieContext(done);
      break;

    default:
      done(new Error('Type not supported: ' + self.campaign_.type));
  }
}

NoticeBuilder.prototype.prepareMusicAlbumContext = function(done) {
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

NoticeBuilder.prototype.prepareMovieContext = function(done) {
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

function logErr(err) {
  if (err)
    console.warn(err);
}