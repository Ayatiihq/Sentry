require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , fs = require('fs-extra')
  , logger = acquire('logger').forFile('4shared.js')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , oauth = require("oauth-lite")
  , crypto = require('crypto')
  , webdriver = require('selenium-webdriver')
  , utilities = acquire('utilities')   
  ;

/* -- 4Shared */
var FourShared = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.domains = ['4shared.com'];
  self.remoteClient = null;
};

util.inherits(FourShared, events.EventEmitter);

FourShared.prototype.authenticate = function(){
  var self  = this;
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
  self.remoteClient.get(infringement.uri).then(function(){
    self.remoteClient.getPageSource().then(function(source){
      var $ = cheerio.load(source);
      var uriInstance = createURI($('a#btnLink').attr('href'));
      if(!uriInstance){
        logger.warn('unable to scrape the directlink');
        done();
      }
      else{
        self.fetchDirectDownload(uriInstance.toString(), pathToUse, done);
      }
    });
  });
}

// Public API
FourShared.prototype.download = function(infringement, pathToUse, done){
  var self  = this;
  var URIInfrg = createURI(infringement.uri);

  if(!URIInfrg){
    logger.error('unable to create an instance from that uri');
    done(new Error('Unable to create a URI from this infringement'));
    return;
  }

  var hasSubDomain = URIInfrg.subdomain() === ''; 
  // var isDirectLink = URIInfrg.suffix().match(/mp3/i) !== null;
  // Handle the easy case of downloading the MP3.
  if(hasSubDomain){
    self.fetchDirectDownload(infringement.uri, pathToUse, done);
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

FourShared.prototype.fetchDirectDownload = function(uri, pathToUse, done){
  var self = this;
  var target = path.join(pathToUse, utilities.genLinkKey());
  var out = fs.createWriteStream(target);
  utilities.requestStream(uri, {}, function(err, req, res, stream){
    if (err){
      logger.error('unable to fetch direct link ' + uri + ' error : ' + err);
      done();
      return;
    }
    stream.pipe(out);
    stream.on('end', function() {
      logger.info('successfully downloaded ' + uri);
      done();
    });
  });
}

FourShared.prototype.finish = function(){
  if(self.remoteClient)
    self.remoteClient.finish(); 
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

