/*
 * 4shared.js: the 4shared downloader
 *
 * (C) 2013 Ayatii Limited
 *
 * Downloads direct and 'hidden' (links leading to pages with download links) links
 * from 4shared
 *
 */

require('sugar');
var acquire = require('acquire')
  , config = acquire('config')
  , cheerio = require('cheerio')
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('4shared.js')
  , path = require('path')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  , Seq = require('seq')  
  , Promise = require('node-promise')    
  ;

var FourShared = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
};

FourShared.prototype.createURI = function(uri){
  var result = null;
  try {
    result = URI(uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + uri); // some dodgy link => move on.
  }
  return result;
}

FourShared.prototype.authenticate = function(){
  var self  = this;
  var promise = new Promise.Promise();

  if(self.remoteClient){
    logger.info('We have an active 4shared session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
  self.remoteClient.get('http://www.4shared.com/login.jsp');

  self.remoteClient.wait(function(){
    self.remoteClient.isElementPresent(webdriver.By.css('#regloginfield')).then(function(present){
      if(present){
        self.remoteClient.findElement(webdriver.By.css('#regloginfield')).click();
        self.remoteClient.findElement(webdriver.By.css('#regloginfield'))
        .sendKeys('conor@ayatii.com');
        self.remoteClient.findElement(webdriver.By.css('#regpassfield')).click();
        self.remoteClient.findElement(webdriver.By.css('#regpassfield'))
        .sendKeys('ayatiian');
        self.remoteClient.findElement(webdriver.By.xpath('/html/body/div/div/div[4]/div/div/form/div/div[8]/input')).click();        
        promise.resolve();
      }
    });
  }, 5000);
  return promise;
}

FourShared.prototype.investigate = function(infringement, pathToUse, done){
  var self  = this;
  self.remoteClient.get(infringement.uri);
  self.remoteClient.sleep(2000 * Number.random(0,5));
  var singlePromise = self.scrapeForSingleFileLink(pathToUse, done);
  singlePromise.then(function(result){
    if(result){
      logger.info('Either we found a file to download or its not available.');
      return;
    }
    else{
      self.scrapeForMultipleFileLinks(pathToUse, done).then(function(multipleResult){
        if(multipleResult){
          logger.info("Found multiple file links - following that path");
          return;
        }
        else{
          // If we got to here, we were unsuccessfull ripping anything useful from the page.
          logger.info('unable to scrape Links - get out of here'); // Just an info not a warn
          done();
        }
      });      
    } 
  });
}

FourShared.prototype.scrapeForSingleFileLink = function(pathToUse, done){
  var self = this;
  var promise = new Promise.Promise();
  // Make sure to wait for the right elements on the page - 4shared crafty buggers.
  self.remoteClient.findElement(webdriver.By.css('div.centered')).then(function(){
    self.remoteClient.getPageSource().then(function(source){
      var $ = cheerio.load(source);
      var directLink = $('a#btnLink').attr('href');
      var fileUnavailable = $('img.warn').attr('src');

      if(directLink){
        logger.info('A direct link found : ' + directLink);
        self.fetchDirectDownload(directLink, pathToUse, done);
        promise.resolve(true);
      }
      else if(fileUnavailable){// Test presence of 'File not available'
        logger.info('This file is not available')
        promise.resolve(true); 
        done();
      }

      if(!directLink && !fileUnavailable){ // if neither then try for multiple links
        logger.info('scrapeForSingleFileLink - was not successfull - try multiple list of files');
        promise.resolve(false);
      }
    });  
  },
  function(err){
    logger.info('Unable to parse for singleFileLink (WHY NOT -) ' + err);
    promise.resolve(false);
    done(err);
  });
  return promise;
}

FourShared.prototype.scrapeForMultipleFileLinks = function(pathToUse, done){
  var self = this;
  var fileLinks = [];
  var promise = new Promise.Promise();
  self.remoteClient.findElement(webdriver.By.css('table.flist')).then(function(){
    self.remoteClient.getPageSource().then(function(source){
      var $ = cheerio.load(source);
      $('table.flist a').each(function(index, elem){
          var file = $(this).attr('href');
          if(file && file !== fileLinks.last() && file !== '#'){
            logger.info('detected ' + $(this).attr('href'));
            fileLinks.push(file);
          }
      });
      if(!fileLinks.isEmpty())
        self.iterateThroughFiles(fileLinks, pathToUse, done);
      promise.resolve(!fileLinks.isEmpty());// Always resolve.      
    });
  },
  function(err){
    logger.error('Unable to scrape for MultipleFileLink : ' + err);
    promise.resolve(false);
    done(err);
  });
  return promise;
}

FourShared.prototype.iterateThroughFiles = function(files, pathToUse, done){
  var self = this;
  Seq(files)
    .seqEach(function(fileLink){
      var thisDone = this;
      logger.info('fetch link ' + fileLink);
      self.remoteClient.get(fileLink);
      self.remoteClient.sleep(1533 * Number.random(0,5));
      var isAFolder = fileLink.has('folder');
      if(isAFolder){
        logger.info('its a folder');
        self.scrapeForMultipleFileLinks(pathToUse, thisDone);
      }
      else{// Assume its a single file
        logger.info('its a single file');
        self.scrapeForSingleFileLink(pathToUse, thisDone);
      }
    })
   .seq(function(){
      logger.info('Finished downloading multiple files');
      done();
    })
    .catch(function(err) {
      logger.warn('Unable to process multiple file downloading: %s', err);
      done(err);
    })    
    ;  
}

FourShared.prototype.fetchDirectDownload = function(uri, pathToUse, done){
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

// Public API --------------------------------------------------------->
FourShared.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var URIInfrg = self.createURI(infringement.uri);

  if(!URIInfrg){
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }
  
  if(URIInfrg.path() === '/'){// Its not an error but I don't see why we need to investigate a pathless uri
    done();
    return;
  } 

  logger.info('uri path :' + URIInfrg.path());
  var hasSubDomain = URIInfrg.subdomain() !== ''; 
  if(hasSubDomain){ // A bit rough - if there is a subdomain, assume its a file !
    self.fetchDirectDownload(infringement.uri, pathToUse, done, true);
  }
  else{
    logger.info('We think this is an indirect link - go forth and authenticate');
    self.authenticate().then(function(){
      self.investigate(infringement, pathToUse, done);
    },
    function(err){
      done(err);
    });
  }
}

FourShared.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    self.remoteClient.quit(); 
}

// No prototype so we can access without creating instance of module
FourShared.getDomains = function() {
  //return ['4shared.com'];
  // TODO don't return any domain for this downloader (because it doesn't work)
  return [];
}

// REST API - lets see if they can shed some light on the why the authentication fails.
/*FourShared.prototype.authenticate = function(){
  var promise = new Promise.Promise();

  var initiateLocation = 'http://www.4shared.com/v0/oauth/initiate';
  var tokenLocation = 'http://www.4shared.com/v0/oauth/token';
  var authorizeLocation = 'http://www.4shared.com/v0/oauth/authorize';

  var state = {oauth_consumer_key: 'e4456725d56c3160ec18408d7e99f096',
               oauth_consumer_secret: '7feceb0b18a2b3f856550e5f1ea1e979fa35d310'}

  oauth.requireTLS = false;
  oauth.fetchRequestToken(state, initiateLocation, {}, function(err, params){
    console.log('oath request token = ' + JSON.stringify(params));
    state.oauth_token = params.oauth_token;
    state.oauth_token_secret = params.oauth_token_secret;
    state.oauth_verifier = '';

    //params.oauth_verifier = 'niii';
    console.log('go to authenticate with  ' + JSON.stringify(state));
    oauth.fetchAccessToken(state, authorizeLocation, null, function(err,params){
      console.log('oauth access token = ' + JSON.stringify(params) + err);
    });
  });
  return promise;
}

FourShared.prototype.get = function(infringement){
  var self = this;
  var URIInfrg = createURI(infringement.uri);
  if(!URIInfrg)return;
  self.authenticate().then(function(){
    console.log ('finished authenticating !');
  });
}*/

