/*
 * mediafire.js: the MediaFire downloader
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


var Mediafire  = module.exports = function (campaign, browser) {
  var attributes = {login: {user:{value: 'subscriptions@ayatii.com', selector: "#login_email"},
                            password:{value:'w00lworths76', selector: "#login_pass"},
                            submit: 'input[id="submit_login"]',
                            at: 'https://www.mediafire.com/ssl_login.php?type=login',
                            authenticated: false},
                    available: [{stepOne: 'span[class="dlFileSize"]'}],
                    unavailable: {inSource: [/Invalid\sor\sDeleted\sFile\./], inUri:[]},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : [],
                    appID: '',
                    appKey: '',
                    authToken: null};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Mediafire, Downloader);

Mediafire.getDomains = function(){
  return ['mediafire.com'];
}
