/*
 * zippyshare.js: the Zippyshare downloader
 * (C) 2013 Ayatii Limited
 * Downloads Zippyshare files
 */

var acquire = require('acquire')
  , util = require('util')
  , logger = acquire('logger').forFile('zippyshare.js')
  , states = acquire('states')
  , Downloader = require('./downloader.js') 
  ;

var Zippyshare = module.exports = function (campaign, browser) {
  var attributes = {login: {authenticated: true},
                    targets: {available: ['a[id="dlbutton"]'],
                              unavailable: [/File\sdoes\snot\sexist\son\sthis\sserver/g]},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : []};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Zippyshare, Downloader);

Zippyshare.getDomains = function(){
  return ['zippyshare.com'];
}


