/*
 * sharebeast.js: the ShareBeast downloader
 * (C) 2013 Ayatii Limited
 *
 * Downloads Sharebeast
 *
 */

require('sugar');
var acquire = require('acquire')
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('test-cyberlocker-manager.js')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , webdriver = require('selenium-webdriver')
  , utilities = acquire('utilities')   
  ;

var Sharebeast = module.exports = function (campaign) {
  var self = this;
  self.campaign = campaign;
  self.remoteClient = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                          .withCapabilities({ browserName: 'firefox', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000);                           
};

Sharebeast.prototype.authenticate = function(){
  var self =this;
  self.remoteClient.get('http://www.sharebeast.com/?op=my_files');
  self.remoteClient.findElement(webdriver.By.css('#uname'))
    .sendKeys('conor-ayatii');
  self.remoteClient.findElement(webdriver.By.css('#pass'))
    .sendKeys('ayatiian');
  // xpath generated from firebug (note to self use click and not submit for such forms,
  // submit was not able to highlight the correct input element).
  return self.remoteClient.findElement(webdriver.By.css('.loginBtn1')).click();
}

// Public api
Sharebeast.prototype.download = function(infringement, pathToUse, done){
  var self = this;
  self.authenticate().then(function(){
    self.remoteClient.sleep(7500);
    self.remoteClient.get(infringement.uri).then(function(){
      self.remoteClient.getPageSource().then(function(source){
        var $ = cheerio.load(source);
        console.log($('div#bigbox h2').html());
      });
    });  
    //self.remoteClient.findElement(webdriver.By.css("input[type='submit']")).click();
  });
}

Sharebeast.prototype.finish = function(){
  var self = this;
  if(self.remoteClient)
    remoteClient.quit();
}

// No prototype so we can access without creating instance of module
Sharebeast.getDomains = function() {
  return ['sharebeast.com'];
}
