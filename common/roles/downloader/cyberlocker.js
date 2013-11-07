"use strict";
/*
 * cyberlocker.js - base class for all cyberlockers
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('cyberlocker.js')
  , Downloads = acquire('downloads')
  , util = require('util')
  , utilities = acquire('utilities')
  , sugar = require('sugar')
  , Campaigns = acquire('campaigns')
  , Seq = require('seq')
  , states = acquire('states')
;

var Cyberlocker = module.exports = function (campaign, browser, attributes) {
  this.campaign = campaign;
  this.browser = browser;
  this.attributes = attributes;
  this.init();
  this.downloads = new Downloads();
};

util.inherits(Cyberlocker, events.EventEmitter);

Cyberlocker.prototype.init = function(){
  var self = this;

  if(self.campaign.type.match(/movie/)){
    self.minSize = 10;
    self.mimeTypes = ["video/"];
  }
  else if(self.campaign.type.match(/music/)){
    self.minSize = 1;
    // Leaving video in there to catch music videos ?
    // we model that ^ scenario more accurately. 
    self.mimeTypes = ["video/", "audio/"];
  }
  else{
    logger.warn('Unable to set the minSize or mimeTypes - what sort of bloody campaign is this ??' + self.campaign.type);
    // set it anyway.
    self.minSize = 1;
    self.mimeTypes = ["video/", "audio/"];
  } 
}

Cyberlocker.prototype.download = function(infringement, done){
  var self  = this;

  if(utilities.getDomain(infringement.uri) === '')
    return done(new Error('Unable to create a URI from this infringement'));
  
  Seq()
    .seq(function(){
      self.login(this);
    })
    .seq(function(){
      self.listenGet(infringement.uri, this);
    })
    .seq(function(directDownload){
      if(self.attributes.strategy.type === states.cyberlockers.strategy.TARGETED)
        self.deployTargeted(infringement, directDownload, this);
      else(self.attributes.strategy.type === states.cyberlockers.strategy.CUSTOM)
        self.attributes.strategy.deploy(infringement, done);
    })
    .seq(function(downloads){
      logger.info('Go ahead and store these Downloads against the infringement ' + JSON.stringify(downloads));
      done();
    })    
    .catch(function(err){
      done(err);
    })
    ;
}

Cyberlocker.prototype.deployTargeted = function(infringement, direct, done){
  var self  = this;

  Seq()
    .seq(function(){
      if(direct)
        return this();
      self.tryTargets(this);
    })
    .seq(function(success){
      self.browser.downloadTargeted(this);
    })            
    .seq(function(){
      self.browser.getStoredDownloads(infringement.uri, this);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/**
 * Login logic - Go login and then wait a bit before returning.
 **/
Cyberlocker.prototype.login = function(done){

  var self = this;

  if(self.attributes.login.authenticated)
    return done();

  self.goLogin(function(err){
    if(err)
      return done(err);
    self.attributes.login.authenticated = true;
    self.browser.wait(2, done);
  });
}

/**
 Enter the login details and login
 * @param {Object}    credentials    The credentials for the particular site (all mandatory)
 *                                   Best be explicit,  login object should look like :
                                                        {user: {'selector': '',
                                                                'value' : ''},
                                                         password : {'selector' : '',
                                                                     'value' : ''},
                                                         submit|click : {'selector' : ''},
                                                         at: ''};
 * @param {function}  done            The Callback
 **/
Cyberlocker.prototype.goLogin = function(done){
  var self = this;

  Seq()
    .seq(function(){
      self.browser.get(self.attributes.login.at, this);
    })
    .seq(function(){
      self.browser.input(self.attributes.login.user, this);
    })
    .seq(function(){
      self.browser.input(self.attributes.login.password, this);
    })    
    .seq(function(){
      if(self.attributes.login.click)
        self.browser.click(self.attributes.login.click, this);
      else
        self.browser.submit(self.attributes.login.submit, this);
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/*
 * Convenience function to listen and then get a given (suspicious) uri.
 */
Cyberlocker.prototype.listenGet = function(uri, done){
  var self = this;
  Seq()
    .seq(function(){
      self.browser.setDownloadPolicy(uri, self.minSize,  self.mimeTypes, this);
    })
    .seq(function(){
      self.browser.getInfringement(uri, this);
    })
    .seq(function(directDownload){
      logger.info('getInfringement returned : ' + directDownload);
      done(null, directDownload);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/*
 * Convenience function to listen, get and downloadAll on a given (suspicious) uri.
 */
Cyberlocker.prototype.listenGetHoover = function(uri, done){
  var self = this;
  Seq()
    .seq(function(){
      self.browser.setDownloadPolicy(uri, self.minSize, self.mimeTypes, this);
    })
    .seq(function(){
      self.browser.getInfringement(uri, this);
    })
    .seq(function(){
      self.browser.downloadAll(done);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/*
 * Try each target in attributes to see.
 */
Cyberlocker.prototype.tryTargets = function(done){
  var self = this;
  Seq(self.attributes.targets)
    .seqEach(function(target){
      var that = this;

      self.browser.click(target, function(err){
        if(err){
          logger.info("we did't find that target, try the next - " + err);
          return that();
        }
        logger.info('seemed to have the target, lets get out of here.');
        done(null, true); 
      });
    })
    .seq(function(){
      logger.warn('hmm failed to hit any target there, exit peacefully');
      done(null, false);
    })    
    .catch(function(err){
      done(err);
    })
    ;
}

Cyberlocker.prototype.finish = function(done){
  this.browser.quit(done);
}




