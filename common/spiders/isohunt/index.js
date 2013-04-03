 /*
 * A IsoHunt spider
 * (C) 2013 Ayatii Limited
 */
require('sugar');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('IsoHunt/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , Seq = require('seq')
  , webdriver = require('selenium-webdriver')
  , Settings = acquire('settings')  
  , TorrentDescriptor = require('./torrent-descriptor.js').TorrentDescriptor
  , TorrentDescriptorStates = require('./torrent-descriptor.js').TorrentDescriptorStates
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
  self.lastRun;
  self.results = [];
  self.completed = [];
  self.root = "http://isohunt.com";

  self.categories = [{id: 2, name: 'music'}];
                     /*{id: 1, name: 'film'},
                     {id: 10, name:'books'},
                     {id: 3, name: 'musicVideo'},
                     {id: 4, name: 'tv'},
                     {id: 5, name: 'games'},
                     {id: 7, name: 'pics'},
                     {id: 8, name: 'anime'},
                     {id: 9, name: 'comics'}];*/

  self.settings_ = new Settings('spider.isohunt');
  // Fetch 'ranLast' from the settings
  self.settings_.get('ranLast', function(err, from) {
    if (err || from === undefined) {
      logger.warn('Couldn\'t get value ranLast' + ':' + err);
      from = '0';
    }
    if(from === '0'){
      self.lastRun = false;
    }
    else{
      self.lastRun = Date.create(from);
    }
    logger.info(util.format('Isohunt spider last ran %s', Date.create(from)));
  });
  // Reset the value before running this instance
  // (just in case this run takes too long and another starts in the interim)
  self.settings_.set('ranLast', Date.now(), function(err){
    if (err) {
      logger.warn("Couldn\'t set value 'ranLast'" + ':' + err);
    }
  });
  self.iterateRequests(self.categories);
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

IsoHunt.prototype.parseCategory = function(done, category, firstPass){
  var self = this;
  var pageResults = [];
  var paginationCount;
  var pageNumber=1;;

  //self.driver.sleep(10000);
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    $("td.releases").each(function(){
      var torrentDescriptor;
      if($(this).attr('width') === '60%'){
        torrentDescriptor = new TorrentDescriptor($(this).children('a').text(), $(this).children('a').attr('href'));
        pageResults.push(torrentDescriptor);   
      }
    });
    // Fragile but doable going on the isoHunt style
    var count = 0;
    $("td.releases").each(function(){
      var torrentDescriptor;
      if($(this).attr('style') === "background:#d9e2ec"){
        pageResults[count].date = Date.create($(this).text());
        count += 1;
      } 
    });
    //self.driver.sleep(10000 * Number.random(0, 10));
    self.results = self.results.union(pageResults);    
    if(firstPass){
      paginationCount = self.ripPageCount($);
    }
    var haveNotSeen = Date.create(pageResults.last().date).isAfter(self.lastRun);
    if (/*TODO*/false && haveNotSeen && pageNumber < paginationCount){
      pageNumber += 1;
      var requestUrl = "http://ca.isohunt.com/release/?ihq=&poster=&cat=" + cat.id + "&ihp=" + pageNumber;
      var fetchPromise = self.driver.get(requestUrl);
      fetchPromise.then(self.parseCategory.bind(self, done, category, false));
    }
    else{
      logger.info("\n Finished " + category.name + '- results size now is ' + self.results.length);
      done();
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

IsoHunt.prototype.parseTorrentPage = function(done, torrent){
  var self = this;
  console.log('parseTorrentPage for :' + torrent.name);
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    var found = false;
    $('a#link1').each(function(){
      try{
        var uri = URI($(this).attr('href'));
        var path = uri.absoluteTo(self.root);
        found = true;
        self.driver.get(path.toString()).then(self.parseInnerTorrentPage.bind(self, done, torrent));
      }        
      catch(err){
        logger.warn('failed to construct uri from link : ' + err);
      }
    });
    // Sometimes the link is not available - usually when it just has been published
    if(!found){
      torrent.currentState = TorrentDescriptorStates.END_OF_THE_ROAD;      
      done();
    }
  });
}

IsoHunt.prototype.parseInnerTorrentPage = function(done, torrent){
  var self = this;
  var found = false;
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    $('a#_tlink').each(function(){
      torrent.fileLink = $(this).attr('href');
      logger.info('Torrent file link for ' + torrent.name + ' - ' + torrent.fileLink);
      found = true;
    });
    $('span#SL_desc').each(function(){
      var tmp = $(this).text().split(' ');
      if(tmp.length > 1){
        torrent.info_hash = tmp[1];
        logger.info('info hash for ' + torrent.name + ' - ' + torrent.info_hash);
        found &= true;
      }
      else{
        logger.error('Unable to scrape the info_hash !');
      }

      if(found)
        torrent.currentState = TorrentDescriptorStates.DOWNLOADING;
      else
        torrent.currentState = TorrentDescriptorStates.END_OF_THE_ROAD;
    });
    done();
  });
}

IsoHunt.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(torrent){
      var done = this;
      if (torrent instanceof TorrentDescriptor){
        if(torrent.currentState === TorrentDescriptorStates.SCRAPING){
          try{
            var uri = URI(torrent.initialLink);
            var path = uri.absoluteTo(self.root);
            self.driver.get(path.toString()).then(self.parseTorrentPage.bind(self, done, torrent));
          }
          catch(err){
            logger.warn('Hmmm issue making a URI - :' + err);
          }
        }
        else if(torrent.currentState === TorrentDescriptorStates.DOWNLOADING){
          console.log('downloading but yeah retire ' + torrent.name);
          self.completed.push(self.results.splice(self.results.indexOf(torrent), 1));
          done();        
        }
        else{
          console.log('retire ' + torrent.name);
          self.completed.push(self.results.splice(self.results.indexOf(torrent), 1));
          done();
        }
      }
      else{
        var category = torrent;
        var requestUrl = "http://ca.isohunt.com/release/?ihq=&poster=&cat=" + category.id + "&ihp=1";
        self.driver.get(requestUrl).then(self.parseCategory.bind(self, done, category, true));
      }
    })
    .seq(function(){
      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.completed.length);
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

