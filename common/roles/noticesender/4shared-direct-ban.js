/*
 * 4shared-direct-ban.js: the 4shared ban action
 * (C) 2013 Ayatii Limited
 *
 * Authenticates with 4Shared and use the direct ban view.
 */

require('sugar');
var acquire = require('acquire')
  , cheerio = require('cheerio')
  , config = acquire('config')
  , logger = acquire('logger').forFile('4shared-direct-ban.js')
  , URI = require('URIjs')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  , Seq = require('seq')  
  , Promise = require('node-promise')    
  ;

var FourSharedDirectBan = module.exports = function (campaign, links) {
  var self = this;
  self.remoteClient = null;
  logger.info('4shared direct ban');
  self.authenticate().then(function(){
    self.remoteClient.sleep(5000);
    self.enterDescription(campaign);
    self.enterLinks(links);
    self.remoteClient.findElement(webdriver.By.css('input[type="button"]')).click();
    var alert; 
    try{
      alert = self.remoteClient.switchTo().alert();
    }
    catch(error){
      logger.warn('Unable to switch to the expected modal alert - getting out of here - ' + error);
      return;
    }
    alert.accept();
  });
};

FourSharedDirectBan.prototype.authenticate = function(){
  var self  = this;

  if(self.remoteClient){
    logger.info('We have an active 4shared session already - assume we are logged in already');
    var promise = new Promise.Promise();
    promise.resolve();
    return promise;
  }
  self.remoteClient = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                          .withCapabilities({ browserName: 'chrome', seleniumProtocol: 'WebDriver' }).build();
  self.remoteClient.manage().timeouts().implicitlyWait(30000); 
  self.remoteClient.get('http://www.4shared.com/login.jsp');
  self.remoteClient.findElement(webdriver.By.css('#loginfield'))
    .sendKeys('neilpatel@ayatii.com');
  self.remoteClient.findElement(webdriver.By.css('#passfield'))
    .sendKeys('ayatii-luck');
  return self.remoteClient.findElement(webdriver.By.xpath('/html/body/div/div/div[4]/div/div/form/div/div[8]/input')).click();
};

FourSharedDirectBan.prototype.enterDescription = function(campaign){
  var self = this;
  var description = 'These links infringe our client  ' + campaign.client + ' copyrighted material - ' + campaign.description;
  self.remoteClient.findElement(webdriver.By.css('[name="description"]'))
    .sendKeys(description);
};

FourSharedDirectBan.prototype.enterLinks = function(links){
  var self = this;
  var input = links.join('\n');
  self.remoteClient.findElement(webdriver.By.css('[name="groupData"]'))
    .sendKeys(input);
};
