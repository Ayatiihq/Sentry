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
                      userID: '46663346',
                      password: 'ayatiian'};
};

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

Rapidshare.prototype.getDownloadLink = function(infringement, pathToUse, done){
  var self = this;
  var uriInstance = null;
  uriInstance = self.createURI(infringement.uri);

  //logger.info('check getDownloadLink for + ' + uriInstance.segment(1) + ' & filename : ' + uriInstance.segment(2));
  var downloadQuery = "https://api.rapidshare.com/cgi-bin/rsapi.cgi?sub=download" +
                      "&fileid=" + 
                      uriInstance.segment(1) + 
                      "&filename=" +
                      uriInstance.segment(2) +
                      "&login=" +
                      self.credentials.userID +
                      "&password=" +
                      self.credentials.password;

  //logger.info('query string for download : ' + downloadQuery);
  request({uri: downloadQuery, json:true},
        function(err, resp, body){
          if(err){
            logger.error('unable to request downloadQuery ' + err);
            done(err);
            return;
          }
          if(body.match(/ERROR:/)){
            logger.info("File is there but rapidshare won't serve it up, more than likely permissions have been set to disable download");
            done();
            return;
          }
          /*
          The only example I could see was when the API returned a different host to query the direct download 
          from. According to the scant docs there is a chance a direct download will result from the download query.
          TODO watch for it and accomodate.
          */
          var results = body.split(',');
          var hostDL = results[0].split(':');
          if(hostDL.length !== 2){
            logger.warn('Unable to figure out host to download from - investigate ' + results);
            done();
            return;
          }
          logger.info('Download host : ' + hostDL[1]);
          var directDownloadQuery = "https://" + hostDL[1] +
                                    "/cgi-bin/rsapi.cgi?sub=download" +
                                    "&fileid=" + 
                                    uriInstance.segment(1) + 
                                    "&filename=" +
                                    uriInstance.segment(2) +
                                    "&login=" +
                                    self.credentials.userID +
                                    "&password=" +
                                    self.credentials.password;
          self.fetchDirectDownload(directDownloadQuery, pathToUse, done);
        }
      );
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
  return self.checkFiles(uriInstance.segment(1), uriInstance.segment(2));
}

Rapidshare.prototype.checkFiles = function(fileID, filename){
  var self = this;
  var promise = new Promise.Promise();
  logger.info('check availability for + ' + fileID + ' & filename : ' + filename);
  var checkFiles = "https://api.rapidshare.com/cgi-bin/rsapi.cgi?sub=checkfiles" +
                    "&login=" +
                    self.credentials.user +
                    "&password=" +
                    self.credentials.password +
                    "&filenames=" + 
                    filename + 
                    "&files=" +
                    fileID;
  //logger.info('query string for checkfiles : ' + checkFiles);
  request({uri: checkFiles, json:true},
        function(err, resp, body){
          if(err){
            logger.error('unable to request checkfiles ' + err);
            promise.reject(err);
            return;
          }
          results = body.split(',');
          if(parseInt(results[4]) === 0){
            logger.info('File is not available');
            promise.resolve(false);
          }
          else if(parseInt(results[4]) === 4){
            logger.info('File is illegal');
            promise.resolve(false);
          }
          else if(parseInt(results[4]) === 1){
            logger.info('File is available !');
            promise.resolve(true);
          }
          else{
            logger.warn("don't know what this is, investigate : " + JSON.stringify(results));
            promise.resolve(false);            
          }
        }
      );
  return promise;
}

// Public API
Rapidshare.prototype.download = function(infringement, pathToUse, done){
  var self = this;

  self.checkAvailability(infringement.uri).then(function(available){
    if(available){
      self.getDownloadLink(infringement, pathToUse, done);
    }
    else{
      logger.info('file is not available or its blocked');
      done();
    }
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
