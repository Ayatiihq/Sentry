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

var Mediafire = module.exports = function () {
  var self = this;
  self.credentials = {user: 'conor@ayatii.com',
                      password: '3HFTB47i',
                      appID: '34352',
                      appKey: 'y6n9weeu2wel1iincalue23wrxv6ae6e7y14e44i',
                      authToken: null};
};

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

