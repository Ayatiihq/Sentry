 /*
 * A IsoHunt spider
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('IsoHunt/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , request = require('request')
  , sugar = require('sugar')
  , URI = require('URIjs')
  , Promise = require('node-promise').Promise
  , webdriver = require('selenium-webdriver')
;
var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var IsoHunt = module.exports = function() {
  this.init();
}

util.inherits(IsoHunt, Spider);

IsoHunt.prototype.init = function() {
  var self = this;  
  self.newDriver();
  self.pageNumber = 1;
  self.paginationCount;
  self.results = [];
  self.categories = {audio: "/release/?cat=2", film: "/release/?cat=2"}

  // TODO - subsitute handles multiple categories
  self.driver.get("http://ca.isohunt.com/release/?ihq=&poster=&cat=2&ihp=1").then(self.parseCategory.bind(self, true));
}

IsoHunt.prototype.newDriver = function(){
  var self = this;

  if(self.driver){
    self.driver.quit();
    self.driver = null;
  }
  self.driver = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                                       .withCapabilities(CAPABILITIES)
                                       .build();
  self.driver.manage().timeouts().implicitlyWait(30000);
}

IsoHunt.prototype.parseCategory = function(firstPass){
  var self = this;
  var pageResults = [];
  self.driver.sleep(10000);
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    $('a').each(function(){
      if($(this).attr('title') === "Search BitTorrent with these keywords"){
        pageResults.push({title: $(this).text(), link:$(this).attr('href')});
      }
    });
    var count = 0;
    $("td.releases").each(function(){
      if($(this).attr('style') === "background:#d9e2ec"){
        pageResults[count].date = Date.create($(this).text());
        count += 1;
      }    
    });

    self.driver.sleep(10000 * Number.random(0, 10));
    self.results = self.results.union(pageResults);
    console.log("pushing " + pageResults.length  + " on to results");
    console.log("results new size " + self.results.length);
    // TODO  compare against date not page number.
    //Date.create(pageResults.last().date);
    if(firstPass){
      self.paginationCount = self.ripPageCount($);
    }
    if(self.pageNumber <= 10/*self.paginationCount*/){
      self.pageNumber += 1;
      var fetchPromise = self.driver.get("http://ca.isohunt.com/release/?ihq=&poster=&cat=2&ihp=" + self.pageNumber);
      fetchPromise.then(self.parseCategory.bind(self, false));
    }
    else{
      console.log(JSON.stringify(self.results));
      console.log("\n Collected " + self.results.length + " results");
      self.stop();
    }
  });
}

IsoHunt.prototype.ripPageCount = function($){
  var count = 0;
  var paginationCount = 0;
  $("table.pager td u").each(function(){
    var line = $(this).text();
    if(count === 0){
      line.words(function(wordText){
        var word = wordText.toNumber();
        if(word !== NaN && word !== 1)
          paginationCount = word;
      });
      count += 1;
    }
  });    
  return paginationCount;
}
//
// Overrides
//
IsoHunt.prototype.getName = function() {
  return "IsoHunt";
}

IsoHunt.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

IsoHunt.prototype.stop = function() {
  var self = this;
  self.driver.quit();
  self.emit('finished');    
}

IsoHunt.prototype.isAlive = function(cb) {
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

IsoHunt.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(channel){
      var done = this;

      if(channel.isRetired()){
        logger.warn('retired channel in live loop %s', channel.name);
        done();
      }
      else if(channel.currentState === TvChannelStates.WRANGLE_IT){
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

