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
  , logger = acquire('logger').forFile('4shared.js')
  , path = require('path')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  , Seq = require('seq')  
  , Promise = require('node-promise')   
  , exec = require('child_process').execFile;
  ;

var HulkShare = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
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
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
  self.remoteClient.get('http://www.hulkshare.com/static.php?op=login');
  self.remoteClient.findElement(webdriver.By.css('input[id=username]'))
    .sendKeys('ayatii');
  self.remoteClient.findElement(webdriver.By.css('input[id=password]'))
    .sendKeys('ayatiian');
  return self.remoteClient.findElement(webdriver.By.css('a#submit_button')).click();
}

HulkShare.prototype.investigate = function(uriInstance, pathToUse){
  var self  = this;
  var isMusic = self.isMusicFile(uriInstance);
  var embed = self.isEmbed(uriInstance);
  isMusic.then(function(err, result){
    if(err)
      console.log('error: ' + err);
    console.log('isMusic ' + result);
  });
}

HulkShare.prototype.isMusicFile = function(uriInstance, pathToUse){
  var self = this;
  var promise = new Promise.Promise();
  self.fetchDirectDownload(uriInstance, pathToUse).then(function(){
    exec('avprobe', [pathToUse], 
          function (error, stdout, stderr){
            stdout.lines(prepare_request);
            }); 
  },
  function(err){
    promise.reject(err);
  });
}

HulkShare.prototype.fetchDirectDownload = function(uriInstance, pathToUse){
  var self = this;
  var promise = new Promise.Promise();

  var target = path.join(pathToUse, utilities.genLinkKey(uriInstance.path()));
  var out = fs.createWriteStream(target);
  logger.info('fetchDirectDownload - target for file ' + target);

  utilities.requestStream(uriInstance.toString(), {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + uriInstance.toString() + ' error : ' + err);
      promise.reject(err);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + uriInstance.toString());
      promise.resolve();
    });
  });
  return promise;
}

// Public API --------------------------------------------------------->
HulkShare.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var URIInfrg = self.createURI(infringement.uri);

  if(!URIInfrg){
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }

  // Check for cdn
  if(URIInfrg.subdomain().match(/cdn[0-9]*/)){
    logger.info('CDN - dud link');
    done();
  }
  // Check for mp3
  if(infringement.uri.match(/\.mp3/)){
    logger.info('mp3 - go direct');
    self.fetchDirectDownload(URIInfrg, pathToUse).then(function(){
      done();
    },
    function(err){
      done(err);
    });
  }
  //done();
  /*self.investigate(URIInfrg, pathToUse).then(function(){
      done();
    },
    function(err){
      done(err);
    });*/
}

HulkShare.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit(); 
}

HulkShare.getDomains = function() {
  return ['hulkshare.com'];
}


