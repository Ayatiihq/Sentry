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
  , config = acquire('config')
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('mediafire.js')
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
  self.remoteClient = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000);
  self.remoteClient.get('https://www.mediafire.com/ssl_login.php?type=login');
  self.remoteClient.findElement(webdriver.By.css('#login_email'))
    .sendKeys(self.credentials.user);
  self.remoteClient.findElement(webdriver.By.css('#login_pass'))
    .sendKeys(self.credentials.password);
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
  if(fileID) 
    return fileID;
  fileID = uriInstance.segment(1)
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

  if(!fileID){
    promise.reject(new Error('cant determine the file id')); // promise or done or whatever
    return promise;
  }

  logger.info('investigate Mediafire file with ID : ' + fileID);
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


Mediafire.prototype.getFiles = function(infringement, pathToUse, done){
  var self = this;
  var promise = new Promise.Promise();
  self.remoteClient.getPageSource().then(function(source){
    var $ = cheerio.load(source);
    if(source.match(/kNO =/)){
      logger.info('Detected the file is available ?');
      var targetLine = source.match(/kNO =\s\"http:\/\/\d\d(\d)?\.\d\d(\d)?\.\d\d(\d)?\.\d\d(\d)?\/[a-zA-Z0-9_]*\/[a-zA-Z0-9_]*\/[a-zA-Z\.\+0-9_\-%]*/)
      if(!targetLine){
        done(new Error('Unable to regex out link ?'));        
      }
      else{
        var fileLink = targetLine[0].split('"')[1].trim();
        logger.info("the File link : " + fileLink);
        self.fetchDirectDownload(fileLink, pathToUse, done);
        // DEBUG
        //var n = source.indexOf('kNO =');
        //console.log('compare against : ' + source.substring(n, n+100));
      }      
    }
    else{
      logger.info('File not available (even though REST API said it was, probably permission denied) - move along');
      done();
    }
  });
}

Mediafire.prototype.fetchDirectDownload = function(uri, pathToUse, done){
  var self = this;

  var uriInstance = null;
  uriInstance = self.createURI(uri);
  if(!uriInstance){
    logger.warn('fetchDirectDownload - Unable to create valid URI instance - ' + uri);
    done();
  }

  var target = path.join(pathToUse, utilities.genLinkKey(uriInstance.path()));
  var out = fs.createWriteStream(target);
  logger.info('fetchDirectDownload - target for file ' + target);

  utilities.requestStream(uri, {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + uri + ' error : ' + err);
      done(err);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + uri);
      done();
    });
  });
}


// Public api
Mediafire.prototype.download = function(infringement, pathToUse, done){
  var self = this;
  self.checkAvailability(infringement).then(function(available){
    logger.info('Is the file available ' + available);
    if(available){
      self.authenticateWeb().then(function(){
        self.remoteClient.sleep(7500);
        console.log('authenticated - what next');
        self.remoteClient.get(infringement.uri).then(function(){
          self.getFiles(infringement, pathToUse, done);
        });
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
