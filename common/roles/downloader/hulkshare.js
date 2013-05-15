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

var HulkShare = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
  self.authenticate();
};

HulkShare.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uriInstance from " + uri); // some dodgy link => move on.
  }
  return result;
}

HulkShare.prototype.authenticate = function(){
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
  self.remoteClient.get('http://www.hulkshare.com/static.php?op=login');
  self.remoteClient.findElement(webdriver.By.css('input[id=username]'))
    .sendKeys('ayatii');
  self.remoteClient.findElement(webdriver.By.css('input[id=password]'))
    .sendKeys('LmpnqYc');
  return self.remoteClient.findElement(webdriver.By.css('a#submit_button')).click();
}

HulkShare.prototype.fetchDirectDownload = function(uriInstance, target){
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
HulkShare.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var uriInstance = self.createURI(infringement.uri);

  if(!uriInstance){
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }

  var target = path.join(pathToUse, utilities.genLinkKey(uriInstance.path()));
  
  function callback(err, mimetype){
    if(err){
      done(err);
    }      
    
    logger.info('mimetype : ' + mimetype);
    var isAudio = mimetype.split('/')[0] === 'audio';
    logger.info('isMusic : ' + isAudio);
    
    if(!isAudio && uriInstance.toString().match(/\.mp3/)){
      logger.warn('dont know what this is !, looks like an mp3 uri but downloaded text more than likely.');
    }

    if(isAudio){
      logger.info('an audio file - moving on ...')
      done();
    }
    else{
      self.remoteClient.get(infringement.uri).then(function(){
        logger.info('ready to go');
        self.remoteClient.getPageSource().then(function(source){
          var $ = cheerio.load(source);
          logger.info('is this the link : ' + $('a.bigDownloadBtn').attr('href'));
          done();
        })  
      });
    }
  }

  self.fetchDirectDownload(uriInstance, target).then(function(){
    Downloads.getFileMimeType(target, callback);
    },
    function(err){
      logger.info(' Problem fetching the file : ' + err);
      done(err);
    });

  //Check for cdn
  //if(URIInfrg.subdomain().match(/cdn[0-9]*/)){
  //  logger.info('CDN - dud link');
  //  done();
  //}
  //Check for mp3 - don't know if we need this !
  /*if(infringement.uri.match(/\.mp3/)){
    logger.info('mp3 - go direct');
    self.fetchDirectDownload(URIInfrg, pathToUse).then(function(){
      done();
    },
    function(err){
      done(err);
    });
  }*/
  //done();
}

HulkShare.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit(); 
}

HulkShare.getDomains = function() {
  return ['hulkshare.com'];
}


