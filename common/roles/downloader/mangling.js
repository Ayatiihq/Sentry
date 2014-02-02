/*
 * mangling.js: 
 *
 * (C) 2014 Ayatii Limited
 *
 * If you want to use cow-mangler to download stuff, use this.
 * So far two strategies are defined
 * - TARGETTED
 * - HOOVERING 
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('mangling.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Approach = require('./approach')
	, Cowmangler = acquire('cowmangler')
  , Seq = require('seq')
  , XRegExp = require('xregexp').XRegExp 
  ;

var Mangling = module.exports = function (campaign, targetHost) {
  this.constructor.super_.call(this, campaign, targetHost);
};

util.inherits(Mangling, Approach);

Mangling.prototype.init = function(){
  var self = this;
  self.browser = new Cowmangler();
  self.browser.newTab();

  self.browser.on('error', function(err){
  	logger.error('Cowmanger error ' + err);
  });
}

Mangling.prototype.download = function(infringement, done){
  var self  = this;

  if(!self.validateExtension(infringement.uri)){
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
      self.host_.downloaderDetails.unavailable.inUri.each(function(rule){
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
      else if(self.host_.downloaderDetails.strategy === states.downloaders.strategy.TARGETED){
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


Mangling.prototype.gatherDownloads = function(infringement, done){
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

Mangling.prototype.deployTargeted = function(infringement, done){
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
Mangling.prototype.login = function(done){
  var self = this;
  if(self.host_.downloaderDetails.login.authenticated)
    return done();

  self.goLogin(function(err){
    if(err)
      return done(err);
    self.host_.downloaderDetails.login.authenticated = true;
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
Mangling.prototype.goLogin = function(done){
  var self = this;

  Seq()
    .seq(function(){
      self.browser.get(self.host_.downloaderDetails.login.at, this);
    })
    .seq(function(){
      self.browser.wait(5000, this);
    })    
    .seq(function(){
      self.browser.input(self.host_.downloaderDetails.login.user, this);
    })
    .seq(function(){
      self.browser.input(self.host_.downloaderDetails.login.password, this);
    })    
    .seq(function(){
      if(self.host_.downloaderDetails.login.click)
        self.browser.click(self.host_.downloaderDetails.login.click, this);
      else
        self.browser.submit(self.host_.downloaderDetails.login.submit, this);
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
Mangling.prototype.listenGet = function(uri, done){
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
Mangling.prototype.listenGetHoover = function(uri, done){
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
Mangling.prototype.targets = function(done){
  var self = this;
  Seq()
    .seq(function(){
      // First try for unavailable, always use regex rules to determine unavailability
      self.tryRegex(self.host_.downloaderDetails.unavailable.inSource, this);
    })
    .seq(function(unavailable){
      if(unavailable){
        logger.info('Found something => We are certain its UNAVAILABLE!');
        return done(null, states.downloaders.verdict.UNAVAILABLE); 
      }
      else{
        self.tryTargets(self.host_.downloaderDetails.available, this);;
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

Mangling.prototype.tryRegex = function(tests, done){
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

Mangling.prototype.tryTargets = function(targets, done){
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

Mangling.prototype.name = function(){
  var self = this;
  return 'Mangling for ' + self.host_._id;
}

Mangling.prototype.finish = function(done){
  this.browser.quit(done);
}

