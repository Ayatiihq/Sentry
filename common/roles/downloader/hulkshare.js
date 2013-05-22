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
  , Seq = require('seq')  
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

Hulkshare.prototype.checkForDMCA = function(){
  var self = this;
  var promise = new Promise.Promise();
  self.remoteClient.getPageSource().then(function(source){
    var $ = cheerio.load(source);

    if($('div.playerNoTrack')){
      logger.info('DMCA blocked or private or somefink - mark as unavailable');
      console.log('DMCAd check source \n\n\n ' + source);
      promise.resolve(true);
      return;
    }
    promise.resolve(false);
    /*$('a').each(function(index, elem){
      if($(elem).attr('class') === "basicDownload")
        logger.info('is this the link : ' + $(elem).attr('href'));
    });*/
  });  
  return promise;  
}

Hulkshare.prototype.checkInlineSingleDownload = function(){
  var self = this;
  var promise = new Promise.Promise();
  promise.resolve(false);
  self.remoteClient.getPageSource().then(function(source){
    var $ = cheerio.load(source);
  });  
  return promise;  
}

Hulkshare.prototype.checkForFileDownload = function(){
  var self = this;
  var promise = new Promise.Promise();
  self.remoteClient.get('chrome://downloads');
  self.remoteClient.getPageSource().then(function(source){
    var $ = cheerio.load(source);
    var directDownload = null;
    directDownload = $('a.src-url').attr('href');    
    if(!directDownload){
      promise.resolve(null);
    }
    else{
      // This is racey but I really don't know how to avoid that race
      // Maybe let it download and sleep until remove from list shows up ...
      self.remoteClient.isElementPresent(webdriver.By.linkText('Cancel')).then(function(present){
        if(present) self.remoteClient.findElement(webdriver.By.linkText('Cancel')).click();          
      });
      promise.resolve(directDownload);      
    }
  });
  return promise;
}

/*Make sure to delete files in download dir*/
Hulkshare.prototype.cleanupFirstPhase = function(fileTarget){
  var promise = new Promise.Promise();
  fs.unlink(fileTarget, function (err) {
    if(err){
      logger.warn('error deleting ' + err + fileTarget);
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

  if(uriInstance.toString().match(/embed_mp3\.php/)){
    logger.info('Detected an embed script - forget about it');
    done();
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
    // Make sure to clear the downloads page 
    .seq(function(){
      var that = this;
      self.clearDownloads().then(function(){that()});    
    })  
    // Try for a direct download - some are accessible this way 
    .seq(function(){
      var that = this;
      var isDirect = self.isDirectDownload(uriInstance, target);
      isDirect.then(function(result){
        if(result){
          done();
          return;
        }
        that();
      });
    })
    // Make sure to remove the file which was downloaded during the previous stage
    .seq(function(){
      var that = this;
      self.cleanupFirstPhase(target).then(function(){that();},
        function(err){
          that(err);
        });
    })    
    // Fetch infringement, wait for a bit
    .seq(function(){
      var that = this;      
      self.remoteClient.get(infringement.uri).then(function(){
        self.remoteClient.sleep(1000);
        that();
        },
        function(err){
          logger.info('remote client get error ' + err);
          that(err);
        }
      );
    })
    // more often than not you need to have an authenticated session before being able to get a file
    .seq(function(){
      var that = this;
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
          logger.warn("Not a direct download - try to scrape page ...");
          that();
        }
      },
      function(err){
        that(err);
      });
    })
    // Fetch infringement, wait for a bit
    .seq(function(){
      var that = this;      
      self.remoteClient.get(infringement.uri).then(function(){
        self.remoteClient.sleep(4000);
        that();
        },
        function(err){
          logger.info('remote client get error ' + err);
          that(err);
        }
      );
    })
    // Check for DMCA or blocking  
    .seq(function(){
      var that = this;
      self.checkForDMCA().then(function(isDMCAd){
        if(isDMCAd){
          logger.info('yep DMCAd');
          done();
          return;
        }
        that();
      });
    })
    .seq(function(){
      logger.info("dont know what this is");
      done();
    })    
    .catch(function(err){
      done(err);
    })      
    ;
}

Hulkshare.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit(); 
}

Hulkshare.getDomains = function() {
  return ['hulkshare.com'];
}