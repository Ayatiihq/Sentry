/*
 * uploaded-net.js: the UploadedNet downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

require('sugar');
var acquire = require('acquire')
  , cheerio = require('cheerio')
  , config = acquire('config')
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
  , chromeHelper = acquire('chrome-helper')
  , when = require('node-promise').when  
;

var UploadedNet = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
  self.authenticated = false;
  self.remoteClient = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
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
  var promArray = []
  var thePromise = new Promise.Promise();

  if(self.authenticated){
    logger.info('We have an active UploadedNet session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  
  var username = function(remoteClient){
    var p = new Promise.Promise();
    remoteClient.findElement(webdriver.By.css('input[value="Account-ID"]')).click().then(function(){
      remoteClient.findElement(webdriver.By.css('input[value="Account-ID"]')).sendKeys('9818821');
      p.resolve();
    });    
    return p;
  }

  var password = function(remoteClientt){
    var pp = new Promise.Promise();
    var passwordInput = remoteClientt.findElement(webdriver.By.css('input[value="Password"]'));
    passwordInput.sendKeys('gcaih1tf');
    pp.resolve();
    return pp;
  }

  self.remoteClient.get('http://www.uploaded.net/#login').then(function(){
    self.remoteClient.sleep(5000);
    promArray.push(username.bind(null, self.remoteClient));
    promArray.push(password.bind(null, self.remoteClient));
    Promise.seq(promArray).then(function(){
      self.authenticated = true;
      self.remoteClient.findElement(webdriver.By.css('button[type="submit"]')).click();
      thePromise.resolve();
    });
  });
  return thePromise;
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
      var tidyUp = chromeHelper.clearDownloads(self.remoteClient);
      when(tidyUp, self.authenticate.bind(self));
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