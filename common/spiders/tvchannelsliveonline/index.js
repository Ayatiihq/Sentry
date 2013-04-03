/*
 * index.js: a TvChannelsOnline spider (http://www.tvchannelsliveonline.com/)
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('TvChannelsOnline.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , request = require('request')
  , sugar = require('sugar')
  , Seq = require('seq')
  , TvChannel = acquire('tv-channel').TvChannel 
  , TvChannelStates = acquire('tv-channel').TvChannelStates
  , URI = require('URIjs')
  , webdriver = require('selenium-webdriver')
  , Wrangler = acquire('endpoint-wrangler').Wrangler
;

require('enum').register();

var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var TvChannelsOnline = module.exports = function() {
  this.init();
}

util.inherits(TvChannelsOnline, Spider);

TvChannelsOnline.prototype.init = function() {
  var self = this;  

  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those channels that for some reason didn't find their way to the end
  self.complete = [] // used to store those channels which completed to a satisfactory end. 
  
  self.root = "http://www.tvchannelsliveonline.com";

  self.categories = [{cat: 'entertainment', currentState: TvChannelStates.CATEGORY_PARSING},
                     //{cat: 'movies', currentState: TvChannelStates.CATEGORY_PARSING},
                     {cat: 'sports', currentState: TvChannelStates.CATEGORY_PARSING}];
  self.newWrangler();
  self.iterateRequests(self.categories);
}

TvChannelsOnline.prototype.newWrangler = function(){
  var self = this;

  if(self.driver){
    self.driver.quit();
    self.driver = null;
  }
  self.driver = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
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
TvChannelsOnline.prototype.getName = function() {
  return "TvChannelsOnline";
}

TvChannelsOnline.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

TvChannelsOnline.prototype.stop = function() {
  var self = this;
  self.wrangler.quit();
  self.emit('finished');
}

TvChannelsOnline.prototype.isAlive = function(cb) {
  cb();
}

TvChannelsOnline.prototype.getChannel = function(self, channel, done){
  //var self = this;
}

TvChannelsOnline.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(item){
      var done = this;

      if(item instanceof TvChannel && item.isRetired()){
        logger.warn('retired item in live loop %s', item.name);
        done();
      }
      else if(item.currentState === TvChannelStates.CATEGORY_PARSING){
        self.driver.get(self.root + '/' + item.cat + '-channels').then(self.scrapeCategory.bind(self, item.cat, done));
      }
      else if(item.currentState === TvChannelStates.CHANNEL_PARSING){
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

TvChannelsOnline.prototype.scrapeCategory = function(category, done){
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
            var channel = new TvChannel('tv.live',
                                        'TvChannelsLiveOnline',
                                        name,
                                        category,
                                        self.root + '/' + category + '-channels',
                                        TvChannelStates.CHANNEL_PARSING);
            self.results.push(channel);
            self.emit('link', channel.constructLink({link_source: category + " page"}, $(this).attr('href')));
            //}
          }
        });
      });    
      done();    
    });
  }
  delayedScrape.delay(1000 * Math.random(), category, done);
}  

TvChannelsOnline.prototype.scrapeChannel = function(channel, done){
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
            self.emit('link', channel.constructLink({remoteStreamer: "embedded @ channel page"}, src));            
            channel.currentState = TvChannelStates.WRANGLE_IT;          
            self.wrangler.on('finished', channel.wranglerFinished.bind(channel, self, done));
            self.wrangler.beginSearch(channel.activeLink.uri);            
          }
        }
      });
      // retire those that didn't manage to move to the right iframe
      if(channel.currentState === TvChannelStates.CHANNEL_PARSING){
        self.channelCompleted(channel, false);
        done();
      }
    });
  }
  delayedScrape.delay(1000 * Math.random());
}

TvChannelsOnline.prototype.channelCompleted = function(channel, successfull){
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
