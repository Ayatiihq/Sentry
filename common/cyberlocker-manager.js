
require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , config = acquire('config')
  , events = require('events')  
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('test-cyberlocker-manager.js')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , cyberLockers = acquire('cyberlockers')
  , oauth = require("oauth-lite")
  , crypto = require('crypto')
  , webdriver = require('selenium-webdriver')
  , utilities = acquire('utilities')   
  ;

var createURI = function(infringement){
  var result = null;
  try {
    result = URI(infringement.uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + infringement.uri); // some dodgy link => move on.
  }
  return result;
}

//-------------------------------------------------------------------------/
// Base CyberLocker
//-------------------------------------------------------------------------/
var Cyberlocker = function (domain) {
  events.EventEmitter.call(this);
  var self = this;
  self.domain = domain;
};

util.inherits(Cyberlocker, events.EventEmitter);

Cyberlocker.prototype.fetchDirectDownload = function(infringement, pathToUse, done){
  var self = this;
  var target = path.join(pathToUse, utilities.genLinkKey());
  var out = fs.createWriteStream(target);
  utilities.requestStream(infringement.uri, {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + infringement.uri + ' error : ' + err);
      done([]);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + infringement.uri);
      done([target]);
    });
  });
}

Cyberlocker.prototype.download = function(){
  throw new Error('Stub!');  
}

//-------------------------------------------------------------------------/
// Deriatives
//-------------------------------------------------------------------------/

/* -- 4Shared */
var FourShared = function () {
  var self = this;
  self.constructor.super_.call(self, '4shared.com');
};

util.inherits(FourShared, Cyberlocker);

FourShared.prototype.authenticate = function(){
  var self  = this;
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); // waits 30000ms before erroring, gives pages enough time to load
  self.remoteClient.get('http://www.4shared.com/login.jsp');
  self.remoteClient.findElement(webdriver.By.css('#loginfield'))
    .sendKeys('conor@ayatii.com');
  self.remoteClient.findElement(webdriver.By.css('#passfield'))
    .sendKeys('ayatiian');
  // xpath generated from firebug (note to self use click and not submit for such forms, submit was not able to
  // highlight the correct input element)
  return self.remoteClient.findElement(webdriver.By.xpath('/html/body/div/div/div[4]/div/div/form/div/div[8]/input')).click();
}

FourShared.prototype.investigate = function(infringement, pathToUse, done){
  var self  = this;
  self.remoteClient.get(infringement.uri).then(function(){
    self.remoteClient.getPageSource().then(function(source){
      var $ = cheerio.load(source);
      var uriInstance = createURI($('a#btnLink').attr('href'));
      if(!URIInfrg){
        logger.error('unable to create an instance from that uri');
        done([]);
        return;
      }
      self.fetchDirectDownload(infringement.uri, pathToUse, done);
    });
  });
}

FourShared.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var URIInfrg = createURI(infringement);

  if(!URIInfrg){
    logger.error('unable to create an instance from that uri');
    done([]);
    return;
  }

  var isDirectLink = URIInfrg.suffix().match(/mp3/i) !== null;
  // Handle the easy case of downloading the MP3.
  if(isDirectLink){
    self.fetchDirectDownload(infringement.uri, pathToUse, done);
  }
  else{
    logger.info('We think this is an indirect link - go forth and authenticate');
    self.authenticate().then(function(){
      self.investigate(infringement, pathToUse, done);
    },
    function(err){
      done([]);
    });
  }
}

// REST API - lets see if they can shed some light on the why the authentication fails.
/*FourShared.prototype.authenticate = function(){
  var promise = new Promise.Promise();

  var initiateLocation = 'http://www.4shared.com/v0/oauth/initiate';
  var tokenLocation = 'http://www.4shared.com/v0/oauth/token';
  var authorizeLocation = 'http://www.4shared.com/v0/oauth/authorize';

  var state = {oauth_consumer_key: 'e4456725d56c3160ec18408d7e99f096',
               oauth_consumer_secret: '7feceb0b18a2b3f856550e5f1ea1e979fa35d310'}

  oauth.requireTLS = false;
  oauth.fetchRequestToken(state, initiateLocation, {}, function(err, params){
    console.log('oath request token = ' + JSON.stringify(params));
    state.oauth_token = params.oauth_token;
    state.oauth_token_secret = params.oauth_token_secret;
    state.oauth_verifier = '';

    //params.oauth_verifier = 'niii';
    console.log('go to authenticate with  ' + JSON.stringify(state));
    oauth.fetchAccessToken(state, authorizeLocation, null, function(err,params){
      console.log('oauth access token = ' + JSON.stringify(params) + err);
    });
  });
  return promise;
}

FourShared.prototype.get = function(infringement){
  var self = this;
  var URIInfrg = createURI(infringement);
  if(!URIInfrg)return;
  self.authenticate().then(function(){
    console.log ('finished authenticating !');
  });
}*/

/* -- MediaFire */

var MediaFire = function () {
  var self = this;
  self.constructor.super_.call(self, 'mediafire.com', '');
  self.credentials = {user: 'conor@ayatii.com',
                      password: '3HFTB47i',
                      appID: '34352',
                      appKey: 'y6n9weeu2wel1iincalue23wrxv6ae6e7y14e44i',
                      authToken: null};
};

util.inherits(MediaFire, Cyberlocker);

MediaFire.prototype.authenticate = function(){
  var self = this;
  var promise = new Promise.Promise();
  var shasum = crypto.createHash('sha1');
  shasum.update(self.credentials.user+self.credentials.password+self.credentials.appID+self.credentials.appKey);  

  var mediafireTokenUrl = "https://www.mediafire.com/api/user/get_session_token.php?email=" + self.credentials.user +
                          "&password=" + self.credentials.password + "&application_id=" + self.credentials.appID + "&signature=" + shasum.digest('hex') +
                          "&response_format=json&version=1";
  
  request({uri: mediafireTokenUrl, json:true},
          function(err, resp, body){
            if(err){
              logger.error('unable to request session token from mediaFire ' + err);
              promise.reject(err);
              return;
            }
            if(body.response && body.response.result === 'Success'){
              self.credentials.authToken = body.response.session_token;
            }
            promise.resolve();
          }
        );
  return promise;
}

MediaFire.prototype.investigate = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  var uriInstance = createURI(infringement);
  if(!uriInstance){
    promise.reject(new Error('cant create a URI instance')); 
    return null;
  }
  var fileID = uriInstance.segment(1);
  console.log('investigate : ' + fileID);
  if(!fileID){
    promise.reject(new Error('cant determine the file id')); // promise or done or whatever
    return;
  }
  var fileInfoRequest = "http://www.mediafire.com/api/file/get_info.php?session_token=" + self.credentials.authToken +
                        "&quick_key=" + fileID + "&response_format=json&version=1"

  request({uri: fileInfoRequest, json:true},
          function(err, resp, body){
            if(err){
              logger.error('unable to request file info from mediaFire ' + err);
              promise.reject(err);
              return;
            }
            if(body.response && body.response.result === 'Error' && 
              body.response.message === 'Unknown or Invalid QuickKey'){
              infringement.state = 7
              //self.verificationObject.notes = "Seems like this file is not valid";
              //self.verificationObject.state = 7;// UNAVAILABLE // are we using verification 
              logger.info("Couldn't find : " + infringement.uri + ' mark as unavailable');              
            }
            else if(body.response && body.response.result === 'Success'){
              console.log('WE FOUND IT !');
              logger.info(JSON.stringify(body));
              infringement.fileID = body.response.file_info.quickkey;
            }
            promise.resolve();
          });
  return promise;
}

MediaFire.prototype.getDownloadLink = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  var linksRequest = "http://www.mediafire.com/api/file/get_links.php?session_token=" + self.credentials.authToken +
                     "&quick_key=" + infringement.fileID + "&response_format=json";

  console.log('\n request with ' + linksRequest);

  request({uri: linksRequest, json:true}, 
          function(err, resp, body){
            if(err){
              promise.reject(err);
              return;
            }
            console.log('body : ' + JSON.stringify(body));
            if(body.response && body.response.result === 'Error'){
              logger.info('error for some reason')  
            }
          }
  );
}

//-------------------------------------------------------------------------/
// CyberlockerManager
//-------------------------------------------------------------------------/
var CyberlockerManager= module.exports = function () {
  events.EventEmitter.call(this);
  var self = this;
  // populate plugins
  self.plugins = [new MediaFire(), new FourShared()];
};

util.inherits(CyberlockerManager, events.EventEmitter);

CyberlockerManager.prototype.process = function(infringement, path, done){
  var self = this;
  logger.info('process cyberlocker link for ' + infringement.uri);
  var relevantPlugin = null;

  var URIInfrg = createURI(infringement);

  if(!URIInfrg)return;

  self.plugins.each(function(plugin){
    if(plugin.domain === URIInfrg.domain())
      relevantPlugin = plugin;
  });

  if(!relevantPlugin)return;

  infringement.fileID = null;

  relevantPlugin.download(infringement, path, done);

  //logger.info('found the relevant plugin');
  /*relevantPlugin.authenticate().then(function(){
    relevantPlugin.investigate(infringement).then(function(){
      if(infringement.fileID != null)
        relevantPlugin.getDownloadLink(infringement);
    },
    function(err){
      logger.err('Problems investigating : ' + err);  
    });
  },
  function(err){
    logger.err('Problems authenticating : ' + err);  
  });*/
}

CyberlockerManager.prototype.canProcess = function(infringement){
  var self = this;
  var URIInfrg = createURI(infringement);

  if(!URIInfrg)return;

  if (cyberLockers.knownDomains.some(URIInfrg.domain()) &&
      self.plugins.map(function(plugin){ return plugin.domain }).some(URIInfrg.domain())){
    return true;
  }

  logger.info('failed to find cyberlocker plugin for ' + URIInfrg.domain())
  return false;
}
