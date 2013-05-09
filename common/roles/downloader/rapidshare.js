/*
 * rapidshare.js: the Rapidshare downloader
 * (C) 2013 Ayatii Limited
 *
 * Downloads direct and 'hidden' (links leading to pages with download links) links
 * from Rapidshare
 *
 */

require('sugar');
var acquire = require('acquire')
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('rapidshare.js')
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

var Rapidshare = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.credentials = {user: 'conor@ayatii.com',
                      password: 'ayatiian'};
};


Rapidshare.prototype.authenticateWeb = function(){
  var self = this;
}

Rapidshare.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
  }
  return result;
}



Rapidshare.prototype.investigate = function(infringement){
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

  logger.info('investigate Rapidshare file with ID : ' + fileID);
  var fileInfoRequest = "http://www.Rapidshare.com/api/file/get_info.php?session_token=" + self.credentials.authToken +
                        "&quick_key=" + fileID + "&response_format=json&version=1"

  request({uri: fileInfoRequest, json:true},
          function(err, resp, body){
            if(err){
              logger.error('unable to request file info from Rapidshare ' + err);
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


Rapidshare.prototype.fetchDirectDownload = function(uri, pathToUse, done){
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

Rapidshare.prototype.checkAvailability = function(uri){
  var self = this;
  var uriInstance = null;
  uriInstance = self.createURI(uri);
  if(!uriInstance){
    logger.warn('fetchDirectDownload - Unable to create valid URI instance - ' + uri);
    var p = new Promise.Promise();
    p.resolve(false);
    return p;
  }
  var fileID;
  fileID = self.determineFileID(uriInstance);
  return self.checkFiles(fileID);
}

Rapidshare.prototype.checkFiles = function(fileID){
  var self = this;
  var promise = new Promise.Promise();
  var checkFiles = "https://api.rapidshare.com/cgi-bin/rsapi.cgi?sub=checkfiles&login=" +
                    self.credentials.user +
                    "&password=" +
                    self.credentials.password + 
                    "files=" +
                    fileID;
  request({uri: checkFiles, json:true},
          function(err, resp, body){
            if(err){
              logger.error('unable to request checkfiles ' + err);
              promise.reject(err);
              return;
            }
            logger.info('body  = ' + JSON.stringify(body));
            promise.resolve(false);
          }
        );
  return promise;
}

Rapidshare.prototype.determineFileID = function(uriInstance){
  var fileID = null;
  fileID = uriInstance.segment(1);
  logger.info('fileID : ' + fileID);
  return fileID;
}

// Public API
Rapidshare.prototype.download = function(infringement, pathToUse, done){
  var self = this;

  self.checkAvailability(infringement.uri).then(function(available){
    logger.info('Is the file available ' + available);
    done();
  },  
  function(err){
    done(err);
  });
}

Rapidshare.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    remoteClient.quit();
}

Rapidshare.getDomains = function() {
  return ['rapidshare.com'];
}
