/*
 * mediafire.js: the MediaFire downloader
 * (C) 2013 Ayatii Limited
 *
 * Downloads direct and 'hidden' (links leading to pages with download links) links
 * from MediaFire
 *
 */

require('sugar');
var acquire = require('acquire')
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('test-cyberlocker-manager.js')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , oauth = require("oauth-lite")
  , crypto = require('crypto')
  , webdriver = require('selenium-webdriver')
  , utilities = acquire('utilities')   
  ;

var Mediafire = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.credentials = {user: 'conor@ayatii.com',
                      password: '3HFTB47i',
                      appID: '34352',
                      appKey: 'y6n9weeu2wel1iincalue23wrxv6ae6e7y14e44i',
                      authToken: null};
};

Mediafire.prototype.authenticateWeb = function(){
  var self = this;
  if(self.remoteClient){
    logger.info('We have an active 4shared session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000);
  self.remoteClient.get('https://www.mediafire.com/ssl_login.php?type=login');
  self.remoteClient.findElement(webdriver.By.css('#login_email'))
    .sendKeys('conor@ayatii.com');
  self.remoteClient.findElement(webdriver.By.css('#login_pass'))
    .sendKeys('3HFTB47i');
  return self.remoteClient.findElement(webdriver.By.css('#submit_login')).click();
}

Mediafire.prototype.authenticateRestfully = function(){
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

Mediafire.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
  }
  return result;
}

Mediafire.prototype.checkAvailability = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  var authenticateRestfullyPromise = self.authenticateRestfully();
  authenticateRestfullyPromise.then(function(){
    self.investigate(infringement).then(function(fileAvailable){
      promise.resolve(fileAvailable);
    },
    function(err){
      promise.reject(err);
    });
  },
  function(err){
    promise.reject(err);
  });
  return promise;
}  

Mediafire.prototype.determineFileID = function(uriInstance){
  var fileID = null;
  fileID = uriInstance.query();
  if(fileID) //&& fileID.length === 11)
    return fileID;
  fileID = uriInstance.segment(1)
  //if(fileID && fileID.length === 11)
  return fileID;
}

Mediafire.prototype.investigate = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  var uriInstance = self.createURI(infringement.uri);
  
  if(!uriInstance){
    promise.reject(new Error('cant create a URI instance')); 
    return promise;
  }

  var fileID = self.determineFileID(uriInstance);
  logger.info('investigate Mediafire fileid : ' + fileID);

  if(!fileID){
    promise.reject(new Error('cant determine the file id')); // promise or done or whatever
    return promise;
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
            var available; 
            if(body.response && body.response.result === 'Error' && 
              body.response.message === 'Unknown or Invalid QuickKey'){
              logger.info("Couldn't find : " + infringement.uri + ' mark as unavailable');              
              available = false;
            }
            else if(body.response && body.response.result === 'Success'){
              logger.info(JSON.stringify(body));
              infringement.fileID = body.response.file_info.quickkey;
              logger.info('File present .... investigate further');
              available = true;
            }
            promise.resolve(available);
          });
  return promise;
}

/*
Mediafire.prototype.getDownloadLink = function(infringement){
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
}*/

// Public api
Mediafire.prototype.download = function(infringement, pathToUse, done){
  var self = this;
  self.checkAvailability(infringement).then(function(available){
    logger.info('Is the file available ' + available);
    if(available){
      self.authenticateWeb().then(function(){
        console.log('authenticated - what next');
        done();
      },
      function(err){
        logger.error('unable to login to MediaFire')
      });
    }
    else{
      done();
    }
  },  
  function(err){
    done(err);
  });
}

Mediafire.prototype.finish = function(){
  if(self.remoteClient)
    remoteClient.quit();
}

// No prototype so we can access without creating instance of module
Mediafire.getDomains = function() {
  return ['mediafire.com'];
}
