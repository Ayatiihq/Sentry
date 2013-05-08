/*
 * sharebeast.js: the ShareBeast downloader
 * (C) 2013 Ayatii Limited
 *
 * Downloads Sharebeast
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
  , webdriver = require('selenium-webdriver')
  , utilities = acquire('utilities')   
  ;

var Sharebeast = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.authenticated = false;
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000);                           
};

Sharebeast.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
  }
  return result;
}

Sharebeast.prototype.authenticate = function(){
  var self =this;

  if(self.authenticated){
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.authenticated = true;
  self.remoteClient.get('http://www.sharebeast.com/?op=login');
  self.remoteClient.findElement(webdriver.By.css('#uname'))
    .sendKeys('conor-ayatii');
  self.remoteClient.findElement(webdriver.By.css('#pass'))
    .sendKeys('ayatiian');
  // xpath generated from firebug (note to self use click and not submit for such forms,
  // submit was not able to highlight the correct input element).
  return self.remoteClient.findElement(webdriver.By.css('.loginBtn1')).click();
}

Sharebeast.prototype.generateFileDownload = function(pathToUse, done){
  var self = this;
  self.remoteClient.findElement(webdriver.By.css('.download-file1')).click().then(function(){
    self.remoteClient.sleep(5000);
    self.remoteClient.get('chrome://downloads').then(function(){
      self.remoteClient.findElement(webdriver.By.linkText('Cancel')).click().then(function(){    
        self.remoteClient.getPageSource().then(function(source){
          var $ = cheerio.load(source);
          var directDownload = $('a.src-url').attr('href');
          logger.info('Direct file link : ' + directDownload);
          self.remoteClient.findElement(webdriver.By.linkText('Clear all')).click().then(function(){
            self.fetchDirectDownload(directDownload, pathToUse, done);
          });
        });
      },
      function(err){
        done(err);
      });
    });      
  },
  function(err){
    done(err);
  });
}

Sharebeast.prototype.fetchDirectDownload = function(uri, pathToUse, done){
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

Sharebeast.prototype.clearDownloads = function(){
  var self = this;
  self.remoteClient.get('chrome://downloads');
  return self.remoteClient.findElement(webdriver.By.linkText('Clear all')).click();    
}


// Public API
Sharebeast.prototype.download = function(infringement, pathToUse, done){
  var self = this;
  self.clearDownloads().then(function(){
    self.authenticate().then(function(){
      self.remoteClient.sleep(5000);
      self.remoteClient.get(infringement.uri).then(function(){
        self.remoteClient.sleep(7500);
        self.remoteClient.getPageSource().then(function(source){
          var $ = cheerio.load(source);
          if($('div#bigbox h2') && $('div#bigbox h2').text() === 'File Not Found'){
            logger.info('File not available for whatever reason - moving on ...');
            done();
          }
          else{
            logger.info('Detected a file ...');
            self.generateFileDownload(pathToUse, done);
          }
        });
      });  
    });
  });    
}


Sharebeast.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    remoteClient.quit();
}

// No prototype so we can access without creating instance of module
Sharebeast.getDomains = function() {
  return ['sharebeast.com'];
}
