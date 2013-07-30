/*
 * chrome-helper.js: helper for chrome downloading
 * (C) 2013 Ayatii Limited
 *
 */
var Promise = require('node-promise')
  , cheerio = require('cheerio')
  , webdriver = require('selenium-webdriver')
;     

module.exports.clearDownloads = function(remoteClient){
  var p = new Promise.Promise();
  remoteClient.get('chrome://downloads').then(function(){
    remoteClient.findElement(webdriver.By.linkText('Clear all')).click();        
    p.resolve();
  });
  return p;
}

/*module.exports.get = function(remoteClient, target){
  var p = new Promise.Promise();
  remoteClient.get(target).then(function(){
  	var insert = "if (window.alert.myAlertText == undefined) {window.alert.myAlertText
= null;  window.alert = function(msg){ window.alert.myAlertText = msg; };}";
		remoteClient.sleep(5000);
  	remoteClient.executeScript(insert).then(function(){
  		p.resolve();
  	},
  	function(err){
  		p.reject();
  	});
  },
  function(err){
    p.reject();
  });
  return p;
}*/

module.exports.checkForFileDownload = function(remoteClient){
  var promise = new Promise.Promise();
  remoteClient.get('chrome://downloads');
  remoteClient.getPageSource().then(function(source){
    var $ = cheerio.load(source);
    var directDownload = null;
    directDownload = $('a.src-url').attr('href');    
    if(!directDownload){
      promise.resolve(null);
    }
    else{
      // This is racey but I really don't know how to avoid that race
      remoteClient.isElementPresent(webdriver.By.linkText('Cancel')).then(function(present){
        if(present) remoteClient.findElement(webdriver.By.linkText('Cancel')).click();          
      });
      promise.resolve(directDownload);      
    }
  });
  return promise;
}

/**
Too much work to do this, need to go extensions and install it everytime
leaving it here just to remind myself some afternoon if i want to have a crack at it.
What needs doing (below) to get this to work is -
Go to chrome://extensions
Go to find extensions page
search for adblock
install adblock
continue with Session

hopefully google will start to support custom profiles with the chromedriver shortly
ridding ourselves of this PITA every session.
**/
module.exports.activateAdBlock = function(remoteClient, logger){
  var promise = new Promise.Promise;
  remoteClient.get('chrome://extensions');
  remoteClient.getPageSource().then(function(source){
    logger.info('extensions source :\n' + source);
    promise.resolve();      
  });
  return promise;
}