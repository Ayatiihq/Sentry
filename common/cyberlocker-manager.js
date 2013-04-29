
require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , config = acquire('config')
  , events = require('events')  
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('test4Shared.js')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , URI = require('URIjs')    
  , cyberLockers = acquire('cyberlockers')
  , oauth = require("oauth-lite")
  ;

var createURI = function(infringement){
  var result = null;
  try {
    result = URI(infringement.uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + infringement.uri); // some dodgy link => move on.
  }
  return result;
}

//-------------------------------------------------------------------------/
// Base CyberLocker
//-------------------------------------------------------------------------/
var Cyberlocker = function (domain) {
  events.EventEmitter.call(this);
  var self = this;
  self.domain = domain;
};

util.inherits(Cyberlocker, events.EventEmitter);

Cyberlocker.prototype.get = function(infringement){
  throw new Error('Stub!');
}
//-------------------------------------------------------------------------/
// Deriatives
//-------------------------------------------------------------------------/

/* -- 4Shared */
var FourShared = function () {
  var self = this;
  self.constructor.super_.call(self, '4shared.com');
  self.authenticate();
  //self.root = 'http://api.4shared.com/v0/files.json?oauth_consumer_key=e4456725d56c3160ec18408d7e99f096/file/50ab8815/';
  //http://www.4shared.com/photo/q0_Jyejr/FWDP12_blog.html
};

util.inherits(FourShared, Cyberlocker);

FourShared.prototype.authenticate = function(){
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
  var URIInfrg = createURI(infringement);
  if(!URIInfrg)return;
  self.authenticate().then(function(){
    console.log ('finished authenticating !');
  });
}

//-------------------------------------------------------------------------/
// CyberlockerManager
//-------------------------------------------------------------------------/
var CyberlockerManager= module.exports = function () {
  events.EventEmitter.call(this);
  var self = this;
  // populate plugins
  self.plugins = [new FourShared()];
};

util.inherits(CyberlockerManager, events.EventEmitter);

CyberlockerManager.prototype.process = function(infringement){
  var self = this;
  logger.info('process cyberlocker link for ' + infringement.uri);
  var relevantPlugin = null;

  var URIInfrg = createURI(infringement);

  if(!URIInfrg)return;

  self.plugins.each(function(plugin){
    if(plugin.domain === URIInfrg.domain())
      relevantPlugin = plugin;
  });

  if(!relevantPlugin)return;
  logger.info('found the relevant plugin');
}

CyberlockerManager.prototype.canProcess = function(infringement){
  var self = this;
  var URIInfrg = createURI(infringement);

  if(!URIInfrg)return;

  if (cyberLockers.knownDomains.some(URIInfrg.domain()) &&
      self.plugins.map(function(plugin){ return plugin.domain }).some(URIInfrg.domain())){
    return true;
  }

  logger.info('failed to find cyberlocker plugin for ' + URIInfrg.domain())
  return false;
}
