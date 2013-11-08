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
                                   'value' : 'subscriptions@ayatii.com'},
                            password : {'selector' : '.jsInputPassword',
                                        'value' : 'fa72b3b24322f86e19456d87a364480f'},
                            submit : 'input[value="Log In"]',
                            at: 'http://www.4shared.com',
                            authenticated: false},
                    targets: {available: ['a[id="btnLink"]',
                                          'a[class="gaClick jsNotPush button-paleblue floatLeft f13 round4 no-line downloadFileButton"]',
                                          'a[class="floatLeft f13 round4 no-line downloadAsZipButton linkShowD3 gaClick jsIsDir"]'],
                              unavailable: ['img[class="warn"]']},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : [/search\.4shared\.com/]};
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
