/*
 * mediafire.js: the MediaFire downloader
 *
 * (C) 2013 Ayatii Limited
 *
 * Downloads direct and 'hidden' (links leading to pages with download links) links
 * from MediaFire
 *
 */

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

var createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
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

Cyberlocker.prototype.fetchDirectDownload = function(uri, pathToUse, done){
  var self = this;
  var target = path.join(pathToUse, utilities.genLinkKey());
  var out = fs.createWriteStream(target);
  utilities.requestStream(uri, {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + uri + ' error : ' + err);
      done([]);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + uri);
      done([target]);
    });
  });
}

Cyberlocker.prototype.download = function(){
  throw new Error('Stub!');  
}


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
  var uriInstance = createURI(infringement.uri);
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
var CyberlockerManager= module.exports = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;
  self.campaign = campaign;
  // populate plugins
  self.plugins = [new MediaFire(), new FourShared()];
};

util.inherits(CyberlockerManager, events.EventEmitter);

CyberlockerManager.prototype.process = function(infringement, path, done){
  var self = this;
  logger.info('process cyberlocker link for ' + infringement.uri);
  var relevantPlugin = null;

  var URIInfrg = createURI(infringement.uri);

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
  var URIInfrg = createURI(infringement.uri);

  if(!URIInfrg)return;

  if (cyberLockers.knownDomains.some(URIInfrg.domain()) &&
      self.plugins.map(function(plugin){ return plugin.domain }).some(URIInfrg.domain())){
    return true;
  }

  logger.info('failed to find cyberlocker plugin for ' + URIInfrg.domain())
  return false;
}
