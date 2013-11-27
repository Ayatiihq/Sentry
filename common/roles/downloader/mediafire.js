/*
 * mediafire.js: the MediaFire downloader
 * (C) 2013 Ayatii Limited
 */
 
require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , Downloader = require('./downloader.js')
  , logger = acquire('logger').forFile('mediafire.js')
  , Promise = require('node-promise')
  , request = require('request')
  , oauth = require("oauth-lite")
  , states = acquire('states')
  , crypto = require('crypto')
  , utilities = acquire('utilities')   
  ;


var Mediafire  = module.exports = function (campaign, browser) {
  var attributes = {login: {user:{value: 'subscriptions@ayatii.com', selector: "#login_email"},
                            password:{value:'w00lworths76', selector: "#login_pass"},
                            submit: 'input[id="submit_login"]',
                            at: 'https://www.mediafire.com/ssl_login.php?type=login',
                            authenticated: false},
                    targets: {available: [''],
                              unavailable: [/Invalid\sor\sDeleted\sFile\./]},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : [],
                    appID: '',
                    appKey: '',
                    authToken: null};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Mediafire, Downloader);

Mediafire.getDomains = function(){
  return ['mediafire.com'];
}

/*
Mediafire.prototype.super = Downloader.prototype;

Mediafire.prototype.download = function(infringement, done){
  var self = this;

  self.checkAvailability(infringement).then(function(available){
    if(!available){
      logger.info("according to mediafire's rest api the file is not available");
      return done();
    }
    self.super.download.call(self, infringement, done);
  },
  function(err){
    done(err);
  });
}

Mediafire.prototype.checkAvailability = function(infringement, done){
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

Mediafire.prototype.authenticateRestfully = function(){
  var self = this;
  var promise = new Promise.Promise();
  var shasum = crypto.createHash('sha1');
  shasum.update(self.attributes.login.user.value+self.attributes.login.password.value+self.attributes.appID+self.attributes.appKey);

  var mediafireTokenUrl = "https://www.mediafire.com/api/user/get_session_token.php?email=" + self.attributes.login.user.value +
                          "&password=" + self.attributes.login.password.value + "&application_id=" + self.attributes.appID + "&signature=" + shasum.digest('hex') +
                          "&response_format=json&version=1";
  
  request({uri: mediafireTokenUrl, json:true},
          function(err, resp, body){
            if(err){
              logger.error('unable to request session token from mediaFire ' + err);
              promise.reject(err);
              return;
            }
            if(body.response && body.response.result === 'Success'){
              self.attributes.authToken = body.response.session_token;
            }
            promise.resolve();
          }
        );
  return promise;
}

Mediafire.prototype.determineFileID = function(uri){
  var fileID = null;
  fileID = utilities.getQuery(uri);
  if(fileID !== '') 
    return fileID;
  fileID = utilities.getSegment(uri, 1)
  return fileID;
}

Mediafire.prototype.investigate = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  
  if(utilities.getDomain(infringement.uri) === '')
    return promise.reject(new Error('cant create a URI instance')); 

  var fileID = self.determineFileID(infringement.uri);
  if(!fileID)
    return promise.reject(new Error('cant determine the file id')); // promise or done or whatever

  logger.info('investigate Mediafire file with ID : ' + fileID);
  var fileInfoRequest = "http://www.mediafire.com/api/file/get_info.php?session_token=" + self.attributes.authToken +
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
              logger.info("Couldn't find : " + infringement.uri);              
              available = false;
            }
            else if(body.response && body.response.result === 'Success'){
              infringement.fileID = body.response.file_info.quickkey;
              logger.info('File present .... investigate further');
              available = true;
            }
            promise.resolve(available);
          });
  return promise;
}
*/

