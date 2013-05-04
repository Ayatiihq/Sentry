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
  , cheerio = require('cheerio')
  , crypto = require('crypto')
  , events = require('events')
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('4shared.js')
  , oauth = require("oauth-lite")
  , os = require('os')
  , path = require('path')
  , request = require('request')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , util = require('util')
  , webdriver = require('selenium-webdriver')
  ;

var Promise = require('node-promise')

var FourShared = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = null;
};

util.inherits(FourShared, events.EventEmitter);

FourShared.prototype.authenticate = function(){
  var self  = this;

  if(self.remoteClient){
    logger.info('We have an active 4shared session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); // waits 30000ms before erroring, gives pages enough time to load
  self.remoteClient.get('http://www.4shared.com/login.jsp');
  self.remoteClient.findElement(webdriver.By.css('#loginfield'))
    .sendKeys('conor@ayatii.com');
  self.remoteClient.findElement(webdriver.By.css('#passfield'))
    .sendKeys('ayatiian');
  // xpath generated from firebug (note to self use click and not submit for such forms,
  // submit was not able to highlight the correct input element).
  return self.remoteClient.findElement(webdriver.By.xpath('/html/body/div/div/div[4]/div/div/form/div/div[8]/input')).click();
}

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

FourShared.prototype.investigate = function(infringement, pathToUse, done){
  var self  = this;
  self.remoteClient.sleep(2000);
  self.remoteClient.get(infringement.uri).then(function(){
    self.remoteClient.getPageSource().then(function(source){
      var $ = cheerio.load(source);
      var directLink = $('a#btnLink').attr('href');
      var uriInstance = null;
      var fileLinks = [];
      // First try for the direct Link
      if(directLink){
        logger.info('A direct link found ? : ' + directLink);
        var uriInstance = self.createURI(directLink);
        if(uriInstance){
          self.fetchDirectDownload(uriInstance.toString(), pathToUse, done, true);
          return;
        }
      }
      //If no good then try to rip file links
      $('table.flist a').each(function(){
        var file = $(this).attr('href');
        if(file && file !== fileLinks.last() && file !== '#'){
          logger.info('detected ' + $(this).attr('href'));
          fileLinks.push(file);
        }
      });

      if(!fileLinks.isEmpty()){
        self.handleMultipleFiles(fileLinks);
        return;
      }
      // If we got to here, we were unsuccessfull ripping anything useful from the page.
      logger.info('unable to scrape a Links'); // Just an info not a warn
      done();
    });
  });
}

FourShared.prototype.fetchDirectDownload = function(uri, pathToUse, done, exitWhenFinished){
  var self = this;
  var target = path.join(pathToUse, utilities.genLinkKey());
  var out = fs.createWriteStream(target);
  utilities.requestStream(uri, {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + uri + ' error : ' + err);
      done(err);
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + uri);
      if(exitWhenFinished)done();
    });
  });
}


// Public API
FourShared.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var URIInfrg = self.createURI(infringement.uri);

  if(!URIInfrg){
    logger.error('unable to create an instance from that uri');
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }

  var hasSubDomain = URIInfrg.subdomain() !== ''; 
  // var isDirectLink = URIInfrg.suffix().match(/mp3/i) !== null;
  // Handle the easy case of downloading the MP3.
  if(hasSubDomain){
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
  return ['4shared.com'];
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

