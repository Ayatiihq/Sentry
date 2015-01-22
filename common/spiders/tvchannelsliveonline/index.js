/*
 * index.js: a TvChannelsLiveOnline spider (http://www.tvchannelsliveonline.com/)
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('tvchannelsliveonline/index.js')
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

require('enum').register();

var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var TvChannelsLiveOnline = module.exports = function() {
  this.init();
}

util.inherits(TvChannelsLiveOnline, Spider);

TvChannelsLiveOnline.prototype.init = function() {
  var self = this;  

  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those channels that for some reason didn't find their way to the end
  self.complete = [] // used to store those channels which completed to a satisfactory end. 
  
  self.root = "http://www.tvchannelsliveonline.com";

  self.categories = [{cat: 'entertainment', currentState: SpideredStates.CATEGORY_PARSING},
                     //{cat: 'movies', currentState: SpideredStates.CATEGORY_PARSING},
                     {cat: 'sports', currentState: SpideredStates.CATEGORY_PARSING}];
  self.newWrangler();
  self.iterateRequests(self.categories);
}

TvChannelsLiveOnline.prototype.newWrangler = function(){
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
//
// Overrides
//
TvChannelsLiveOnline.prototype.getName = function() {
  return "tvchannelsliveonline";
}

TvChannelsLiveOnline.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

TvChannelsLiveOnline.prototype.stop = function() {
  var self = this;
  self.wrangler.quit();
  self.emit('finished');
}

TvChannelsLiveOnline.prototype.isAlive = function(cb) {
  cb();
}

TvChannelsLiveOnline.prototype.getChannel = function(self, channel, done){
  //var self = this;
}

TvChannelsLiveOnline.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(item){
      var done = this;

      if(item instanceof Spidered && item.isRetired()){
        logger.warn('retired item in live loop %s', item.name);
        done();
      }
      else if(item.currentState === SpideredStates.CATEGORY_PARSING){
        self.driver.get(self.root + '/' + item.cat + '-channels').then(self.scrapeCategory.bind(self, item.cat, done));
      }
      else if(item.currentState === SpideredStates.CHANNEL_PARSING){
        self.driver.get(item.activeLink.uri).then(self.scrapeChannel.bind(self, item, done));
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
        logger.info("We are finished !");
        self.stop();
      }
    })    
  ;    
}

TvChannelsLiveOnline.prototype.scrapeCategory = function(category, done){
  var self = this;
  var $ = null;

  function delayedScrape(category, done){
      self.driver.getPageSource().then(function(source){
      $ = cheerio.load(source);
      $('div .movies').each(function(){
        $(this).find('a').each(function(){
          if($(this).attr('title')){
            var name = $(this).text().toLowerCase().trim();
            //if(name.match(/^espn/)){
            var channel = new Spidered('tv.live',
                                        name,
                                        category,
                                        self.root + '/' + category + '-channels',
                                        SpideredStates.CHANNEL_PARSING);
            console.log('created : ' + channel);
            self.results.push(channel);
            self.emit('link', channel.constructLink(self, {link_source: category + " page"}, $(this).attr('href')));
            //}
          }
        });
      });    
      done();    
    });
  }
  delayedScrape.delay(1000 * Math.random(), category, done);
}  

TvChannelsLiveOnline.prototype.scrapeChannel = function(channel, done){
  var self = this;
  var $ = null;
  
  function delayedScrape(){
    self.driver.getPageSource().then(function scrapeIframes(source){
      $ = cheerio.load(source);
      $('iframe').each(function(i, elem){
        var width = $(this).attr('width');
        var height = $(this).attr('height');
        var src = $(this).attr('src');

        if(width && height){
          var ratio = parseFloat(width) / parseFloat(height);
          // Determine the right iframe by aspect ratio
          if(ratio > 1.2 && ratio < 1.5){
            self.emit('link', channel.constructLink(self, {remoteStreamer: "embedded @ channel page"}, src));            
            channel.currentState = SpideredStates.WRANGLE_IT;          
            self.wrangler.on('finished', channel.wranglerFinished.bind(channel, self, done));
            self.wrangler.beginSearch(channel.activeLink.uri);            
          }
        }
      });
      // retire those that didn't manage to move to the right iframe
      if(channel.currentState === SpideredStates.CHANNEL_PARSING){
        self.channelCompleted(channel, false);
        done();
      }
    });
  }
  delayedScrape.delay(1000 * Math.random());
}

TvChannelsLiveOnline.prototype.channelCompleted = function(channel, successfull){
  var self = this;
  channel.retire();

  if(successfull === true){
    self.complete.push(channel);
  } 
  else{
    self.incomplete.push(channel);      
    logger.warn("\n\n\nThis channel did not complete - " + JSON.stringify(channel));
  }
  // remove it from the results array
  self.results.each(function(res){
    if(res.activeLink.uri === channel.activeLink.uri){
      self.results.splice(self.results.indexOf(res), 1);
    }
  });
}
