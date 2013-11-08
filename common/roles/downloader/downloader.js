"use strict";
/*
 * downloader.js - base class for all downloaders
 * In time this needs to spread out. i.e. the logic needs to belong with each approach.
 * approach.cow-mangling has all browser stuff which in turn can have strategies.
 * Similarly approach.restful will have just web stuff
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('downloader.js')
  , Downloads = acquire('downloads')
  , util = require('util')
  , utilities = acquire('utilities')
  , sugar = require('sugar')
  , Campaigns = acquire('campaigns')
  , Seq = require('seq')
  , states = acquire('states')
;

var Downloader = module.exports = function (campaign, browser, attributes) {
  this.campaign = campaign;
  this.browser = browser;
  this.attributes = attributes;
  this.init();
  this.downloads = new Downloads();
};

util.inherits(Downloader, events.EventEmitter);

Downloader.prototype.init = function(){
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

Downloader.prototype.validURI = function(uri){
  var self = this;
  var result = true;

  if(utilities.getDomain(uri) === ''){
    logger.warn('Unable to create a URI from this infringement');
    result = false;
  }
  
  self.attributes.blacklist.each(function(suspect){
    if(uri.match(suspect)){
      logger.warn('This we believe to be a URI that we should ignore : ' + uri);
      result = false;
    }
  });
  return result;
}

Downloader.prototype.download = function(infringement, done){
  var self  = this;

  if(!self.validURI(infringement.uri))
    return done();

  Seq()
    .seq(function(){
      self.login(this);
    })
    .seq(function(){
      self.browser.wait(2, this);
    })
    .seq(function(){
      self.listenGet(infringement.uri, this);
    })
    .seq(function(directDownload){
      if(directDownload){
        self.gatherDownloads(infringement, this);
      }
      else if(self.attributes.strategy === states.downloaders.strategy.TARGETED){
        self.deployTargeted(infringement, this);
      }
    })
    .seq(function(result){
      done(null, result);
    })    
    .catch(function(err){
      done(err);
    })
    ;
}

Downloader.prototype.gatherDownloads = function(infringement, done){
  var self = this;
  self.browser.downloadTargeted(infringement.uri, function(err, downloads){
    if(err)
      return done(err);
    done(null, {verdict: states.downloaders.verdict.AVAILABLE, payLoad: downloads});
  });
}

Downloader.prototype.deployTargeted = function(infringement, done){
  var self  = this;
  Seq()
    .seq(function(){
      self.tryTargets(this);
    })
    .seq(function(state){
      // trust the cyberlocker.
      if(state === states.downloaders.verdict.AVAILABLE){
        return self.gatherDownloads(infringement, done);
      }
      // handle unavailable and stumped 
      done(null, {verdict: state});
    })            
    .catch(function(err){
      done(err);
    })
    ;
}

/**
 * Login logic - Go login and then wait a bit before returning.
 **/
Downloader.prototype.login = function(done){
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
Downloader.prototype.goLogin = function(done){
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
Downloader.prototype.listenGet = function(uri, done){
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
Downloader.prototype.listenGetHoover = function(uri, done){
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
 * Try each target (available and unavailable) in attributes.
 */
Downloader.prototype.tryTargets = function(done){
  var self = this;
  Seq()
    .seq(function(){
      self.tryAvailables(this);
    })
    .seq(function(available){
      if(available){
        logger.info('Found something => Available!')
        return done(null, states.downloaders.verdict.AVAILABLE); 
      }
      self.tryUnavailables(this);
    })
    .seq(function(unavailable){
      if(unavailable){
        logger.info('Found something => Unavailable!')
        done(null, states.downloaders.verdict.UNAVAILABLE); 
      }
      else{
        logger.info('Bugger cant find anything on the page ');
        done(null, states.downloaders.verdict.STUMPED);
      }
    })        
    .catch(function(err){
      done(err);
    })
    ;    
}

Downloader.prototype.tryAvailables = function(done){
  var self = this;
  Seq(self.attributes.targets.available)
    .seqEach(function(target){
      var that = this;
      logger.info('trying target ' + target);
      if(target instanceof RegExp){
        self.detectString(target).then(function(result){
          if(result)
            return done(null, true)
          that();
        },
        function(err){
          that(err);
        });
      }
      else{
        // it must be a selector
        self.browser.click(target, function(err){
          if(err){
            logger.info("we did't find that target, try the next - " + err);
            return that();
          }
          logger.info('seemed to have the target, lets get out of here.');
          done(null, true); 
        });
      }
    })
    .seq(function(){
      logger.warn('hmmm failed to hit no available target there');
      done(null, false);
    })    
    .catch(function(err){
      done(err);
    })
    ;
}

Downloader.prototype.tryUnavailables = function(done){
  
Downloader.prototype.tryUnavailables = function(done){
  var self = this;
  Seq(self.attributes.targets.unavailable)
    .seqEach(function(target){
      var that = this;
      if(target instanceof RegExp){
        self.detectString(target).then(function(result){
          if(result)
            return done(null, true)
          that();
        },
        function(err){
          that(err);
        });
      }
      else{
        logger.info('trying target ' + target);
        self.browser.click(target, function(err){
          if(err){
            logger.info("we did't find that target, try the next - " + err);
            return that();
          }
          logger.info('seemed to have the target, lets get out of here.');
          done(null, true); 
        });
      }
    })
    .seq(function(){
      logger.warn('and failed to hit no unavailable target - ????');
      done(null, false);
    })    
    .catch(function(err){
      done(err);
    })
    ;
}

Downloader.prototype.finish = function(done){
  this.browser.quit(done);
}




