/*
 * 4shared.js: the 4shared downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('4shared.js')
  , states = acquire('states')
  , Cyberlocker = require('./cyberlocker.js')
  , Seq = require('seq')
  , oauth = require('oauth-lite')
  ;

var Fourshared = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': '.jsInputLogin',
                                   'value' : 'conor@ayatii.com'},
                            password : {'selector' : '.jsInputPassword',
                                        'value' : 'ayatiian'},
                            submit : 'input[value="Log In"]',
                            at: 'http://www.4shared.com',
                            authenticated: false},
                    targets: ['a#btnLink'],
                    approach : states.cyberlockers.method.COW_MANGLING,
                    strategy : {type: states.cyberlockers.strategy.CUSTOM, deploy: this.customParser}};

  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Fourshared, Cyberlocker);

Fourshared.getDomains = function(){
  return ['4shared.com'];
}

Fourshared.prototype.customParser = function(infringement, done){
  var self = this;
  logger.info('custom parsing !');
  done();
}

// Public API --------------------------------------------------------->
/*Fourshared.prototype.download = function(infringement, done){
  var self  = this;
  
  Seq()
    .seq(function(){
      self.authenticate(this);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

// REST API - lets see if they can shed some light on the why the authentication fails.
Fourshared.prototype.authenticate = function(done){

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

    console.log('go to authenticate with  ' + JSON.stringify(state));
    oauth.fetchAccessToken(state, authorizeLocation, null, function(err,params){
      console.log('oauth access token = ' + JSON.stringify(params) + err);
      done();
    });
  });
}*/
