/*
 * uploaded-net.js: the Uploadednet downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('uploaded-net.js')
  , states = acquire('states')
  , Downloader = require('./downloader.js')
  ;

var Uploadednet = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': 'input[value="Account-ID"]',
                                   'value' : '9818821'},
                            password : {'selector' : '#pass',
                                        'value' : 'gcaih1tf'},
                            click : 'button[type="submit"]',
                            at: 'http://www.uploaded.net/#login',
                            authenticated: false},
                    targets: [],
                    approach : states.cyberlockers.method.COW_MANGLING};

  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Uploadednet, Downloader);

Uploadednet.getDomains = function(){
  return ['uploaded.net'];
}

