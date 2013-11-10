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
  , Downloader = require('./downloader.js')
  ;



var Hulkshare = module.exports = function (campaign, browser) {
  var attributes = {login: {user: {'selector': 'input[id=username]',
                                   'value' : 'subscriptions@ayatii.com'},
                            password : {'selector' : 'input[id=password]',
                                        'value' : '04fd6cbb77ab088bd19015797c4f96d9'},
                            submit : 'a[id=submit_button]',
                            at: 'http://www.Hulkshare.com/static.php?op=login',
                            authenticated: false},
                    targets: {available: ['a[class="bigDownloadBtn basicDownload"'],
                              unavailable: ['div[class="playerNoTrack"]']},
                    approach : states.downloaders.method.COWMANGLING,
                    strategy : states.downloaders.strategy.TARGETED,
                    blacklist : []};
  this.constructor.super_.call(this, campaign, browser, attributes);
};

util.inherits(Hulkshare, Downloader);

Hulkshare.getDomains = function(){
  return ['hulkshare.com'];
}

