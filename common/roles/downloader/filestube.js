/*
 * filestube.js: the filestube downloader
 *
 * (C) 2013 Ayatii Limited
 *
 * Downloads direct and 'hidden' (links leading to pages with download links) links
 * from filestube
 *
 */

require('sugar');
var acquire = require('acquire')
  , cheerio = require('cheerio')
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('filestube.js')
  , path = require('path')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  , Seq = require('seq')  
  , Promise = require('node-promise')    
  ;

var Filestube = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
};

Filestube.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
  }
  return result;
}

Filestube.prototype.authenticate = function(){
  var self  = this;

  if(self.remoteClient){
    logger.info('We have an active filestube session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
  self.remoteClient.get('http://www.filestube.com/account/login.html');
  self.remoteClient.findElement(webdriver.By.css('input[name="username"]'));
    .sendKeys('conorayatii');
  self.remoteClient.findElement(webdriver.By.css('input[name="password"]'))
    .sendKeys('ayatiian');
  // xpath generated from firebug (note to self use click and not submit for such forms,
  // submit was not able to highlight the correct input element).
  return self.remoteClient.findElement(webdriver.By.css('#accCent')).click();
}

//key = '051b6ec16152e2a74da5032591e9cc84'
// Public API
Filestube.prototype.download = function(infringement, pathToUse, done){
  self.authenticate().then(function(){
      logger.info('authenticated !');
      self.finish();
  });
}

Filestube.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    remoteClient.quit();
}

Filestube.getDomains = function() {
  return ['filestube.com'];
}

