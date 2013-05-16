/*
 * hulkshare.js: the Hulkshare downloader
 *
 * (C) 2013 Ayatii Limited
 *
 * Downloads direct and 'hidden' (links leading to pages with download links) links
 *
 */

require('sugar');
var acquire = require('acquire')
  , cheerio = require('cheerio')
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('hulkshare.js')
  , path = require('path')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  , Seq = require('seq')  
  , Promise = require('node-promise')   
  , exec = require('child_process').execFile
  , Downloads = acquire('downloads')
  ;

var Hulkshare = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
};

Hulkshare.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uriInstance from " + uri); // some dodgy link => move on.
  }
  return result;
}

Hulkshare.prototype.authenticate = function(){
  var self  = this;

  if(self.remoteClient){
    logger.info('We have an active Hulkshare session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
  self.remoteClient.get('http://www.Hulkshare.com/static.php?op=login');
  self.remoteClient.findElement(webdriver.By.css('input[id=username]'))
    .sendKeys('ayatii');
  self.remoteClient.findElement(webdriver.By.css('input[id=password]'))
    .sendKeys('LmpnqYc');
  return self.remoteClient.findElement(webdriver.By.css('a#submit_button')).click();
}

Hulkshare.prototype.fetchDirectDownload = function(uriInstance, target){
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

Hulkshare.prototype.clearDownloads = function(){
  var self = this;
  self.remoteClient.get('chrome://downloads');
  return self.remoteClient.findElement(webdriver.By.linkText('Clear all')).click();    
}

Hulkshare.prototype.checkForDMCA = function(infringement){
  var self = this;
  var promise = new Promise.Promise();
  self.remoteClient.get(infringement.uri).then(function(){
    self.remoteClient.sleep(Number.random(3,9) * 500);
    self.remoteClient.getPageSource().then(function(source){
      var $ = cheerio.load(source);
      if($('div.playerNoTrack')){
        logger.info('DMCA blocked or private or somefink - mark as unavailable');
        promise.resolve(true);
        return;
      }
      promise.resolve(false);
      /*$('a').each(function(index, elem){
        if($(elem).attr('class') === "basicDownload")
          logger.info('is this the link : ' + $(elem).attr('href'));
      });*/
    });  
  },
  function(err){
    promise.reject(err);
  });
  return promise;  
}

Hulkshare.prototype.checkForFileDownload = function(){
  var self = this;
  var promise = new Promise.Promise();
  self.remoteClient.get('chrome://downloads');
  self.remoteClient.getPageSource().then(function(source){
    var $ = cheerio.load(source);
    var directDownload = $('a.src-url').attr('href');
    logger.info('Direct file link : ' + directDownload);
    if(directDownload)
      self.remoteClient.findElement(webdriver.By.linkText('Cancel')).click();
    promise.resolve(directDownload);
  });
  return promise;
}

Hulkshare.prototype.isWebRoute = function(infringement, target, done){
  var self = this;
  logger.info('go the web route with : ' + infringement.uri);  

  self.checkForFileDownload().then(function(directDownload){
    if(directDownload){
      logger.info('detected a direct download !');
      self.fetchDirectDownload(URI(directDownload), target).then(function(){
        done();
        },
        function(err){
          done(err);
      });
    }
    else{
      self.checkForDMCA(infringement).then(function(yes){
        if(yes){
          logger.info('yep DMCAd');
          done();   
        }
        else{
          logger.warn("erm don't know - more scraping needed ?");
          //TODO
          done();
        }
      },
      function(err){
        done(err);
      });
    }
  });
}
/*Make sure to delete files in download dir*/
Hulkshare.prototype.cleanupFirstPhase = function(fileTarget){
  var promise = new Promise.Promise();
  fs.unlink(fileTarget, function (errr) {
    if(errr){
      logger.warn('error deleting ' + errr + fileTarget);
      promise.reject(err);
    }
    else{
      promise.resolve();
    }
  });
  return promise;
}

Hulkshare.prototype.isDirectDownload = function(uriInstance, target){
  var self = this;
  var promise = new Promise.Promise();

  function determineAudio(err, mimetype){
    if(err){
      promise.reject(err);
      return;
    }        
    
    logger.info('mimetype : ' + mimetype);
    var isAudio = mimetype.split('/')[0] === 'audio';
    
    if(isAudio){
      logger.info('an audio file - moving on ...')
      promise.resolve(true);
      return;
    }
    promise.resolve(false)
    //self.webRoute(infringement, pathToUse, done);
  }
  self.fetchDirectDownload(uriInstance, target).then(function(){
    Downloads.getFileMimeType(target, determineAudio);
    },
    function(err){
      logger.info(' Problem fetching the file : ' + err);
      promise.reject(err);
  });
  return promise;
}

// Public API --------------------------------------------------------->
Hulkshare.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var uriInstance = self.createURI(infringement.uri);

  if(!uriInstance){
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }

  var target = path.join(pathToUse, utilities.genLinkKey(uriInstance.path()));
  
  self.authenticate().then(function(){
    self.clearDownloads().then(function(){
      var isDirect = self.isDirectDownload(uriInstance, target);
      isDirect.then(function(result){
        if(result){
          done();
        }
        else{
          self.cleanupFirstPhase(target).then(function(){
            self.remoteClient.get(infringement.uri).then(function(){
              self.remoteClient.sleep(5000);
              self.isWebRoute(infringement, target, done);
            },
            function(err){
              logger.info('remote client get error ' + err);
              done(err);
            });
          },
          function(err){
            logger.info('Error deleting files from target director');
            done(err);
          });
        }
      },      
      function(err){
        logger.info('isDirectDownload poo - 2');
        done(err);
      });
    });
  });  
}

Hulkshare.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit(); 
}

Hulkshare.getDomains = function() {
  return ['hulkshare.com'];
}