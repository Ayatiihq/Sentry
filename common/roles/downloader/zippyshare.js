/*
 * zippyshare.js: the Zippyshare downloader
 * (C) 2013 Ayatii Limited
 * Downloads Zippyshare files
 */

require('sugar');
var acquire = require('acquire')
  , config = acquire('config')
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('zippyshare.js')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , webdriver = require('selenium-webdriver')
  , utilities = acquire('utilities')   
  , chromeHelper = acquire('chrome-helper')
  ;

var Zippyshare = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.authenticated = false;
  self.remoteClient = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000);                           
};

Zippyshare.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
  }
  return result;
}

Zippyshare.prototype.fetchDirectDownload = function(uri, pathToUse, done){
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

// Public API
Zippyshare.prototype.download = function(infringement, pathToUse, done){
  var self = this;
  chromeHelper.clearDownloads(self.remoteClient).then(function(){
    self.remoteClient.get(infringement.uri).then(function(){
      self.remoteClient.sleep(5000);
      self.remoteClient.isElementPresent(webdriver.By.css('#dlbutton')).then(function(present){
        if(present){ 
          self.remoteClient.findElement(webdriver.By.css('#dlbutton')).click();          
          self.remoteClient.sleep(1000);
          chromeHelper.checkForFileDownload(self.remoteClient).then(function(directPath){
            if(directPath)
              self.fetchDirectDownload(directPath, pathToUse, done);
          });
        }
      });
    });
  });    
}

Zippyshare.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit();
}

// No prototype so we can access without creating instance of module
Zippyshare.getDomains = function() {
  return ['zippyshare.com'];
}
