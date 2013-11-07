/*
 * hulkshare.js: the Hulkshare downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('hulkshare.js')
  , states = acquire('states')
  , Cyberlocker = require('./cyberlocker.js')
  ;

var Hulkshare = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': 'input[id=username]',
                                   'value' : 'ayatii'}, 
                            password : {'selector' : 'input[id=password]',
                                        'value' : 'LmpnqYc'},
                            submit : 'input[id=submit_button]',
                            at : 'http://www.hulkshare.com/static.php?op=login',
                            authenticated: false},
                    targets: [],
                    approach : states.cyberlockers.method.COW_MANGLING};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Hulkshare, Cyberlocker);

Hulkshare.getDomains = function(){
  return ['hulkshare.com'];
}

