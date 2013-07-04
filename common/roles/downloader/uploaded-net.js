/*
 * uploaded-net.js: the UploadedNet downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

require('sugar');
var acquire = require('acquire')
  , cheerio = require('cheerio')
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('uploaded-net.js')
  , path = require('path')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  , Seq = require('seq')  
  , Promise = require('node-promise')   
  , exec = require('child_process').execFile
  , Downloads = acquire('downloads')
  ;

var UploadedNet = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
};

UploadedNet.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uriInstance from " + uri); // some dodgy link => move on.
  }
  return result;
}

UploadedNet.prototype.authenticate = function(){
  var self  = this;

  if(self.remoteClient){
    logger.info('We have an active UploadedNet session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
  self.remoteClient.get('http://www.uploaded.net/login');
  self.remoteClient.findElement(webdriver.By.css('input[name=id]'))
    .sendKeys('9818821');
  self.remoteClient.findElement(webdriver.By.css('input[name=pw]'))
    .sendKeys('gcaih1tf');
  return self.remoteClient.findElement(webdriver.By.css('button[type=submit]')).click();
}

UploadedNet.prototype.fetchDirectDownload = function(uriInstance, target){
  var self = this;
  var promise = new Promise.Promise();
  var out = fs.createWriteStream(target);

  utilities.requestStream(uriInstance.toString(), {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + uriInstance.toString() + ' error : ' + err);
      promise.reject(err);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + uriInstance.toString() + ' to ' + target);
      promise.resolve();
    });
  });
  return promise;
}

UploadedNet.prototype.clearDownloads = function(){
  var self = this;
  var p = new Promise.Promise();
  self.remoteClient.get('chrome://downloads').then(function(){
    self.remoteClient.findElement(webdriver.By.linkText('Clear all')).click();        
    p.resolve();
  });
  return p;
}


// Public API --------------------------------------------------------->
UploadedNet.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var uriInstance = self.createURI(infringement.uri);
 
  if(!uriInstance){
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }

  var target = path.join(pathToUse, utilities.genLinkKey(uriInstance.path()));
  
  Seq()
    .seq(function(){
      	var that = this;
        self.authenticate().then(function(){that()},
        	function(err){
          	that(err);
      	});
    })
    .catch(function(err){
      done(err);
    })      
    ;
}

UploadedNet.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit(); 
}

UploadedNet.getDomains = function() {
  return ['uploaded.net'];
}