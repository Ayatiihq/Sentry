/*
 * Rapidshare.js: the Rapidshare downloader
 * (C) 2013 Ayatii Limited
 */
 
require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , Downloader = require('./downloader.js')
  , logger = acquire('logger').forFile('mediafire.js')
  , Promise = require('node-promise')
  , request = require('request')
  , oauth = require("oauth-lite")
  , states = acquire('states')
  , crypto = require('crypto')
  , utilities = acquire('utilities')   
  ;

var Rapidshare  = module.exports = function (campaign, browser) {
  var attributes = {login: {user:{value: 'ayatii-monitor', selector: 'input[id="js-login-username"]'},
                            password:{value:'w00lworths3322', selector: 'input[id="js-login-password"]'},
                            click: 'a[class="signup blue white-bg white-hover orange-bg-hover"]',
                            at: 'https://rapidshare.com/login',
                            authenticated: false},
                    targets: {available: [{stepOne: 'a[class="signup blue white-bg white-hover orange-bg-hover"]',
                                           stepTwo: 'span[id="js_label_mydata"]'}],
                              unavailable: [/File\snot\sfound/]},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : [],
                    redirectRules: [/\/desktop\/error\//]};

  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Rapidshare, Downloader);

Rapidshare.getDomains = function(){
  return ['rapidshare.com'];
}


