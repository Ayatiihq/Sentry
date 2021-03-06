/*
 * A ZonyTv spider
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('zonytv/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , request = require('request')
  , sugar = require('sugar')
  , Seq = require('seq')
  , Spidered = acquire('spidered').Spidered 
  , SpideredStates = acquire('spidered').SpideredStates
  , URI = require('URIjs')
  , webdriver = require('selenium-webdriver')
  , Wrangler = acquire('endpoint-wrangler').Wrangler
;

var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var ZonyTv = module.exports = function() {
  this.init();
}

util.inherits(ZonyTv, Spider);

ZonyTv.prototype.init = function() {
  var self = this;  

  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those channels that for some reason didn't find their way to the end
  self.complete = [] // used to store those channels which completed to a satisfactory end. 
  
  self.newWrangler();
  
  self.driver.get("http://www.zonytvcom.info").then(self.parseIndex.bind(self));
}

ZonyTv.prototype.newWrangler = function(){
  var self = this;

  if(self.driver){
    self.driver.quit();
    self.driver = null;
  }
  self.driver = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                                       .withCapabilities(CAPABILITIES)
                                       .build();

  self.driver.manage().timeouts().implicitlyWait(30000);
  self.wrangler = new Wrangler(self.driver);
  self.wrangler.addRule(acquire('wrangler-rules').rulesLiveTV);

  self.wrangler.on('error', function onWranglerError(error) {
    logger.info('got error when scraping with selenium : ' + error.toString());
    self.wrangler.removeAllListeners();
    self.stop();
  });
}

ZonyTv.prototype.parseIndex = function(){
  var self = this;
  var pageResults = [];

  var createChannel = function(name, link){
    var channel = new Spidered('tv.live',                                
                                name,
                                "",
                                "http://www.zonytvcom.info/",
                                SpideredStates.WRANGLE_IT);
    self.results.push(channel);
    self.emit('link', channel.constructLink(self, {link_source: "zonytvcom home page"}, link));
  }

  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    var tmpLinks = [];
    var pageChannels = [];
    // first, simply take every second one of each link on the page
    $('a').each(function(i, elem){
      var link = URI($(elem).attr('href')).absoluteTo('http://zonytvcom.info').toString();
      if (tmpLinks.length > 0 && tmpLinks[tmpLinks.length-1] === link){
        pageChannels.push(link);
      }
      tmpLinks.push(link);
    });
    var channelCount = 0;
    // and match it with the text from a td
    // very fragile but good for now (as these things will change)
    $('td').each(function(i, elem){
      var name = $(elem).text().trim().toLowerCase();
      if(pageChannels.length > channelCount)
        createChannel(name, pageChannels[channelCount]);
      channelCount ++;
    });
    self.iterateRequests(self.results);
  });  
}

//
// Overrides
//
ZonyTv.prototype.getName = function() {
  return "ZonyTv";
}

ZonyTv.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

ZonyTv.prototype.stop = function() {
  var self = this;
  self.wrangler.quit();
  self.emit('finished');    
}

ZonyTv.prototype.isAlive = function(cb) {
  cb();
}

ZonyTv.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(channel){
      var done = this;

      if(channel.isRetired()){
        logger.warn('retired channel in live loop %s', channel.name);
        done();
      }
      else if(channel.currentState === SpideredStates.WRANGLE_IT){
        self.wrangler.on('finished', channel.wranglerFinished.bind(channel, self, done));
        self.wrangler.beginSearch(channel.activeLink.uri);                    
      }      
    })
    .seq(function(){

      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.complete.length);
      logger.info("InCompleted length : " + self.incomplete.length);
      
      // if we have more go again
      if(self.results.length > 0){
        self.iterateRequests(self.results);
      }
      else{
        self.stop();
      }
    })    
  ;    
}

// TODO this needs to be moved to tv-channel.js (not until fancystreemed spider is refactored)
ZonyTv.prototype.channelCompleted = function(channel, successfull){
  var self = this;
  channel.retire();  

  if(successfull === true){
    self.complete.push(channel);
  } 
  else{
    self.incomplete.push(channel);      
    logger.warn("\n\n\nThis channel did not complete - " + JSON.stringify(channel));
  }

  self.results.each(function(res){
    if(res.activeLink.uri === channel.activeLink.uri){
      self.results.splice(self.results.indexOf(res), 1);
    }
  });
}
