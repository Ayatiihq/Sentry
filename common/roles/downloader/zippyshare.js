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
                    available: [{stepOne: 'a[id="dlbutton"]'}],
                    unavailable: {inSource: [/File\sdoes\snot\sexist\son\sthis\sserver/g, 
                                            /File\shas\sexpired\sand\sdoes\snot\sexist\sanymore\son\sthis\sserver/g],
                                            inUri: []},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : []};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Zippyshare, Downloader);

Zippyshare.getDomains = function(){
  return ['zippyshare.com'];
}


