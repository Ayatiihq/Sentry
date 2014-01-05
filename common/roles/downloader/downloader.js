"use strict";
/*
 * downloader.js - base class for all downloaders
 * In time this needs to spread out. i.e. strategy and approach should be modelled properly
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('downloader.js')
  , util = require('util')
  , utilities = acquire('utilities')
  , sugar = require('sugar')
  , Campaigns = acquire('campaigns')
  , Seq = require('seq')
  , states = acquire('states')
  , XRegExp = require('xregexp').XRegExp 
;

var Downloader = module.exports = function (campaign, browser, attributes) {
  this.campaign = campaign;
  this.browser = browser;
  this.attributes = attributes;
  this.init();
};

util.inherits(Downloader, events.EventEmitter);

Downloader.prototype.init = function(){
  var self = this;
  self.ignoreExts = [];

  if(self.campaign.type.match(/movie/)){
    self.minSize = 10;
    self.mimetypes = ["video/"];
    self.ignoreExts.union(['.mp3', '.ape', '.m4a', '.wav', '.flac', '.aiff']);
  }
  else if(self.campaign.type.match(/music/)){
    self.minSize = 1;
    // Leaving video in there to catch music videos ???
    // we model that ^ scenario more accurately. 
    self.mimetypes = ["video/", "audio/"];
  }
  else{
    logger.warn('Unable to set the minSize or mimetypes - what sort of bloody campaign is this ??' + self.campaign.type);
    // set it anyway.
    self.minSize = 1;
    self.mimetypes = ["video/", "audio/"];
  } 
  // For now We don't care about these at all.
  self.ignoreExts.union(['.png', '.jpg', '.jpeg', '.gif', '.js', '.swf']);
}

Downloader.prototype.validURI = function(uri){
  var self = this;
  var result = true;
  // check for useless extensions
  self.ignoreExts.each(function(useless){
    if(uri.endsWith(useless))
      result = false;
  });
  
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


  if(!self.validURI(infringement.uri)){
    logger.info('return, pointless - ' + infringement.uri);
    return done(null, {verdict: states.downloaders.verdict.RUBBISH});
  }

  Seq()
    .seq(function(){
      self.login(this);
    })   
    .seq(function(){
      self.listenGet(infringement.uri, this);
    })
    .seq(function(results){ 
      var shouldIgnore = false;
      // first check to see that the landing uri (the last redirect)
      // doesn't match any known pattern which would show the true status of the infringement.   
      self.attributes.unavailable.inUri.each(function(rule){
        if(results.redirects.last().match(rule)){
          logger.info('last redirect matches ignore rule, mark UNAVAILABLE !');
          shouldIgnore = true; 
        }
      });
      
      if(shouldIgnore)
        return this(null, {verdict: states.downloaders.verdict.UNAVAILABLE, payLoad: []});
      
      if(results.result === true){
        self.gatherDownloads(infringement, this);
      }
      else if(self.attributes.strategy === states.downloaders.strategy.TARGETED){
        self.deployTargeted(infringement, this);
      }
    })
    .seq(function(result){
      logger.info('Result: ' + JSON.stringify(result) + ' uri: ' + infringement.uri);
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
    // Assume success.
    var theVerdict = states.downloaders.verdict.AVAILABLE;
    if(err)
      return done(err);
    // If'ts empty, assume it fails download-policy
    if(downloads.isEmpty())
      theVerdict = states.downloaders.verdict.FAILED_POLICY;

    done(null, {verdict: theVerdict, payLoad: downloads});
  });
}

Downloader.prototype.deployTargeted = function(infringement, done){
  var self  = this;
  Seq()
    .seq(function(){
      self.browser.wait(5000, this);
    })
    .seq(function(){
      self.targets(this);
    })
    .seq(function(state){
      // trust the cyberlocker.
      if(state === states.downloaders.verdict.MAYBE){
        return self.gatherDownloads(infringement, done);
      }
      // handle unavailable, rubbish and stumped 
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
    done();
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
      self.browser.wait(5000, this);
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
      logger.info('done loggin in.')
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
      self.browser.setDownloadPolicy(uri, self.minSize,  self.mimetypes, this);
    })
    .seq(function(){
      self.browser.getInfringement(uri, this);
    })
    .seq(function(results){
      logger.info('getInfringement returned : ' + JSON.stringify(results));
      done(null, results);
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
      self.browser.setDownloadPolicy(uri, self.minSize, self.mimetypes, this);
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
Downloader.prototype.targets = function(done){
  var self = this;
  Seq()
    .seq(function(){
      // First try for unavailable, always use regex rules to determine unavailability
      self.tryRegex(self.attributes.unavailable.inSource, this);
    })
    .seq(function(unavailable){
      if(unavailable){
        logger.info('Found something => We are certain its UNAVAILABLE!');
        return done(null, states.downloaders.verdict.UNAVAILABLE); 
      }
      else{
        self.tryTargets(self.attributes.available, this);;
      }
    })
    .seq(function(available){
      if(available){
        logger.info('Found something => MAYBE !');
        done(null, states.downloaders.verdict.MAYBE); 
      }
      else{
        logger.info('Bugger cant find anything on the page - STUMPED');
        done(null, states.downloaders.verdict.STUMPED);
      }
    })        
    .catch(function(err){
      done(err);
    })
    ;    
}

Downloader.prototype.tryRegex = function(tests, done){
  logger.info('Try regex');
  var self = this;
  Seq()
    .seq(function(){
      self.browser.getSource(this);      
    })
    .seq(function(source){
      var result = false;
      tests.each(function(match){
        if(XRegExp.exec(source, match)){
          result = true;
        }
      });
      logger.info('Regex result : ' + result);
      done(null, result);
    })
    .catch(function(err){
      logger.warn('Xregex error. - ' + err);
      done(err);
    })
    ;    
}

Downloader.prototype.tryTargets = function(targets, done){
  var self = this;
  
  if(targets.isEmpty())
    return done(null,false);

  Seq(targets)
    .seqEach(function(target){
      var that = this;
      Seq()
        .seq(function(){
          self.browser.click(target.stepOne, this, 5000);
        })
        .seq(function(){
          if(!target.stepTwo){
            logger.info('one step available checker, seem to have hit the target');
            return done(null, true);
          }
          logger.info('one step available checker, seem to have hit step one. try for two');
          self.browser.click(target.stepTwo, this, 5000);
        })
        .seq(function(){
          logger.info('two step available checker, seem to have hit both targets');
          done(null, true);
        })
        .catch(function(err){
          logger.info('Failed to hit the target steps, try next')
          that();
        })
      ;
    })
    .seq(function(){
      logger.info('failed to hit available targets');
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




