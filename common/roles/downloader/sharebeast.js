/*
 * sharebeast.js: the sharebeast downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('sharebeast.js')
  , Downloader = require('./downloader.js')
  , states = acquire('states')
  ;

var Sharebeast = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': '#uname',
                                  'value' : 'conor-ayatii',
                                  'delay': 5000},
                            password : {'selector' : '#pass',
                                  'value' : 'ayatiian',
                                  'delay': 5000},
                            click : 'a[id="loginLink"]',
                            at: 'http://www.sharebeast.com/?op=login',
                            authenticated: false},
                    available: [{stepOne:'input[class="download-file1"]'}],
                    unavailable: {inSource: [/File\sNot\sFound/], inUri: []},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : []};  
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Sharebeast, Downloader);

Sharebeast.getDomains = function(){
  return ['sharebeast.com'];
}

