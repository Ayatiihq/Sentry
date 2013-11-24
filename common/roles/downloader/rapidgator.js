/*
 * rapidgator.js: the rapidgator downloader
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('4shared.js')
  , states = acquire('states')
  , Downloader = require('./downloader.js')
  , Seq = require('seq')
  , oauth = require('oauth-lite')
  ;

var Rapidgator = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': 'input[id="LoginForm_email"]',
                                   'value' : 'subscriptions@ayatii.com'},
                            password : {'selector' : 'input[id="LoginForm_password"]',
                                        'value' : 'af60d2d0169f363b720c8af8cec5007c'},
                            click : 'a[class="btn send-message"]',
                            at: 'https://rapidgator.net/auth/login',
                            authenticated: false},
                    targets: {available: ['a[class="btn btn-download"]'],
                              unavailable: [/File\snot\sfound/]},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : []};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Rapidgator, Downloader);

Rapidgator.getDomains = function(){
  return ['rapidgator.net'];
}
