/*
 * Rapidshare.js: the Rapidshare downloader
 * (C) 2013 Ayatii Limited
 */
 
require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , Cyberlocker = require('./cyberlocker.js')
  , logger = acquire('logger').forFile('mediafire.js')
  , Promise = require('node-promise')
  , request = require('request')
  , oauth = require("oauth-lite")
  , states = acquire('states')
  , crypto = require('crypto')
  , utilities = acquire('utilities')   
  ;

var Rapidshare  = module.exports = function (campaign, browser) {
  var attributes = {login: {user:{value: 'conor-ayatii', selector: 'input[id="js-login-username"]'},
                            password:{value:'ayatiian', selector: 'input[id="js-login-password"]'},
                            click: 'a[class="signup blue white-bg white-hover orange-bg-hover"]',
                            at: 'https://rapidshare.com/login',
                            authenticated: false},
                    targets: [],
                    approach : states.cyberlockers.method.COW_MANGLING};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Rapidshare, Cyberlocker);

Rapidshare.getDescription = function(){
  return ['rapidshare.com'];
}


