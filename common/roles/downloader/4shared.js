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
  , Downloader = require('./downloader.js')
  , Seq = require('seq')
  , oauth = require('oauth-lite')
  ;

var Fourshared = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': '.jsInputLogin',
                                  'value' : 'subscriptions@ayatii.com',
                                  'delay': 5000},
                            password : {'selector' : '.jsInputPassword',
                                        'value' : 'fa72b3b24322f86e19456d87a364480f',
                                        'delay': 5000},
                            submit : 'input[class="submit-light round4 gaClick"]',
                            at: 'http://www.4shared.com/web/login',
                            authenticated: false},
                    available: [{stepOne: 'a[id="btnLink"]'}],
                    unavailable: {inSource: [/This\sfile\sis\sno\slonger\savailable\sbecause\sof\sa\sclaim\sby/,
                                             /The\sfile\slink\sthat\syou\srequested\sis\snot\svalid\./],
                                  inUri: []},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : [/search\.4shared\.com/]};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Fourshared, Downloader);

Fourshared.getDomains = function(){
  return ['4shared.com'];
}

Fourshared.prototype.customParser = function(infringement, done){
  var self = this;
  logger.info('custom parsing !');
  done();
}
