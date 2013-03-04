/*
 * TvChannelsOnline.js: a TvChannelsOnline spider (http://www.tvchannelsliveonline.com/)
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
  , Service = require('./service')
  , URI = require('URIjs')
  , webdriver = require('selenium-webdriverjs')
  , Wrangler = acquire('endpoint-wrangler').Wrangler
;

require('enum').register();
var TvChannelsOnlineStates = module.exports.TvChannelsOnlineStates = new Enum(['CATEGORY_PARSING',
                                                                               'WRANGLE_IT',
                                                                               'END_OF_THE_ROAD']);
var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var TvChannelsOnline = module.exports = function() {
  this.init();
}

util.inherits(TvChannelsOnline, Spider);

TvChannelsOnline.prototype.init = function() {
  var self = this;  

  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those services that for some reason didn't find their way to the end
  self.complete = [] // used to store those services which completed to a satisfactory end. 
  // used to store services that have multiple links at a certain level (i.e. those with link 1-5 at the top of the screen)  
  self.horizontallyLinked = [] 
  
  self.root = "http://www.tvchannelsliveonline.com";

  self.categories = [//{cat: 'entertainment', currentState: TvChannelsOnlineStates.CATEGORY_PARSING},
                     //{cat: 'movies', currentState: TvChannelsOnlineStates.CATEGORY_PARSING},
                     {cat: 'sports', currentState: TvChannelsOnlineStates.CATEGORY_PARSING}];
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

  self.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
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
  var self = this;

  logger.info('Is alive called');

  if (!self.alive)
    self.alive = 1;
  else
    self.alive++;

  if (self.alive > 4)
    cb(new Error('exceeded'));
  else
    cb();
}

TvChannelsOnline.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(item){
      var done = this;

      if(item instanceof Service && item.isRetired()){
        logger.warn('retired item in live loop %s', item.name);
        done();
      }
      else if(item.currentState === TvChannelsOnlineStates.CATEGORY_PARSING){
        self.driver.get(self.root + '/' + item.cat + '-channels').then(self.scrapeCategory.bind(self, item.cat, done));
      }
      else if(item.currentState === TvChannelsOnlineStates.WRANGLE_IT){
        console.log("\n\n HERE about to begin a wrangler for %s \n\n", item.activeLink.uri);
        self.wrangler.on('finished', self.wranglerFinished.bind(self, item, done));
        self.wrangler.beginSearch(item.activeLink.uri);
      }
    })
    .seq(function(){
      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.complete.length);
      logger.info("InCompleted length : " + self.incomplete.length);
      logger.info("Those with multiple horizontal Links: " + self.horizontallyLinked.length);
      
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
  var src = null;
  var $ = null;

  self.driver.getPageSource().then(function(source){
    $ = cheerio.load(source);
    src = source;
    $('div .movies').each(function(){
      $(this).find('a').each(function(){
        if($(this).attr('title')){
          var name = $(this).text().toLowerCase();
          if(name.match(/^star/) !== null){
            var service = new Service('tv.live',
                                      'TvChannelsOnline',
                                      name,
                                      category,
                                      self.root + '/' + category + '-channels',
                                      TvChannelsOnlineStates.WRANGLE_IT);
            console.log('just created %s', service.name);
            self.results.push(service);
            self.emit('link', service.constructLink("linked from " + category + " page", $(this).attr('href')));
          }
        }
      });
    });    
    done();    
  });
}  

TvChannelsOnline.prototype.wranglerFinished = function(service, done, items){
  var self = this;
  items.each(function traverseResults(x){
    if(x.parents.length > 0){
      x.parents.reverse();
      x.parents.each(function emitForParent(parent){
        self.emitLink(service, "unwrangled this as a parent", parent);
      });
    }
    self.emit('link', service.constructLink("stream parent uri", x.uri));
    x.items.each(function rawBroadcaster(item){
      self.emitLink(service, "raw broadcaster ip", item.toString());  
    });
  });
  self.serviceCompleted(service, items.length > 0);
  self.wrangler.removeAllListeners();
  done();
}


TvChannelsOnline.prototype.serviceCompleted = function(service, successfull){
  var self = this;
  service.retire();  
  if(successfull === true){
    self.complete.push(service);
  } 
  else{
    self.incomplete.push(service);      
    logger.warn("\n\n\nThis service did not complete - " + JSON.stringify(service));
  }

  self.results.each(function(res){
    if(res.activeLink.uri === service.activeLink.uri){
      self.results.splice(self.results.indexOf(res), 1);
    }
  });
}

TvChannelsOnline.prototype.emitLink = function(service, desc, link){
  var self = this;

  var payload = service.constructLink(desc, link);
  if(payload.success === true){
    self.emit('link', payload.link);
  }
  else{
    logger.error("Trying to emit a link but the link is empty %s for %s @ %s", desc, service.name, service.currentState);
    self.serviceCompleted(service, false);
  }
  return payload.success;
}
