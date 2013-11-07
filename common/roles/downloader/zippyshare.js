/*
 * zippyshare.js: the Zippyshare downloader
 * (C) 2013 Ayatii Limited
 * Downloads Zippyshare files
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('uploaded-net.js')
  , states = acquire('states')
  , Cyberlocker = require('./cyberlocker.js')
  ;

var Zippyshare = module.exports = function (campaign, browser) {
  var attributes = {login : {authenticated: true},
                    targets: ['a[id="dlbutton"]'],
                	approach : states.cyberlockers.method.COW_MANGLING};

  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Zippyshare, Cyberlocker);

Zippyshare.getDescription = function(){
  return ['zippyshare.com'];
}


