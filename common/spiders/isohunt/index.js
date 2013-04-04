 /*
 * A IsoHunt spider
 * (C) 2013 Ayatii Limited
 */
require('sugar');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('isohunt/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , URI = require('URIjs')
  , Seq = require('seq')
  , webdriver = require('selenium-webdriver')
  , Settings = acquire('settings')  
  , Spidered = acquire('spidered').Spidered 
  , SpideredStates = acquire('spidered').SpideredStates  
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
  self.spiderReleases = false; // by default spider the torrents section
  self.lastRun;
  self.results = [];
  self.completed = [];
  self.root = "http://isohunt.com";

  self.categories = [{id: 2, name: 'music'}];//,// for now just do music
                     //{id: 1, name: 'film'},
                     //{id: 10, name: 'musicVideo'}];
                     /*{id: 3, name: 'tv'},
                     {id: 4, name: 'games'},
                     {id: 5, name: 'apps'},
                     {id: 6, name: 'pics'},
                     {id: 7, name: 'anime'},
                     {id: 8, name: 'comics'},
                     {id: 9, name:'books'}];*/

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
  self.driver = new webdriver.Builder().usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                                       .withCapabilities(CAPABILITIES)
                                       .build();
  self.driver.manage().timeouts().implicitlyWait(30000);
}

IsoHunt.prototype.formatGet = function(catId, pageNumber, age){
  var self = this;
  var page = pageNumber ? "&ihp=" + pageNumber : "&ihp=1";
  if(self.spiderReleases){
    return "http://ca.isohunt.com/release/?ihq=&poster=&cat=" + catId + page;
  }
  else{
    return "http://ca.isohunt.com/torrents/?ihs1=5&iho1=d&iht=" + catId + page;
  }
}

IsoHunt.prototype.parseCategory = function(done, category, pageNumber){
  var self = this;
  if(self.spiderReleases){
    self.parseReleasesCategory(done, category, pageNumber);
  }
  else{
    self.parseTorrentsCategory(done, category, pageNumber);
  }
}

IsoHunt.prototype.ripPageCount = function($){
  var self = this;
  var count = 0;
  var paginationCount = 0;
  if(self.spiderReleases){
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
  }
  else{
    $("table.pager td b").each(function(){
      var word = $(this).text().toNumber();
      if(word !== NaN)
        paginationCount = word
    });
  }    
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
    .seqEach(function(torrent){
      var done = this;
      if (torrent instanceof Spidered){
        if(torrent.currentState === SpideredStates.ENTITY_PAGE_PARSING){
          try{
            var uri = URI(torrent.activeLink.uri);
            var path = uri.absoluteTo(self.root);
            self.driver.sleep(1000 * Number.random(0, 10));      

            if(self.spiderReleases){
              self.driver.get(path.toString()).then(self.parseReleasePage.bind(self, done, torrent));
            }      
            else{
              self.driver.get(path.toString()).then(self.parseTorrentPage.bind(self, done, torrent));
            }
          }
          catch(err){
            logger.warn('Hmmm issue making a URI - :' + err);
          }
        }
        else if(torrent.currentState === SpideredStates.DOWNLOADING){
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
        self.driver.get(self.formatGet(category.id)).then(self.parseCategory.bind(self, done, category, 1));
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
/// Parse Torrents avenue ///////////////////////////////////////////////////
IsoHunt.prototype.parseTorrentsCategory = function(done, category, pageNumber){
  var self = this;
  var pageResults = [];
  var paginationCount;

  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    $('a').each(function(){
      var torrentDescriptor;
      if($(this).attr('id') && $(this).attr('id').match(/link[0-9]+/)){
        torrentDescriptor = new Spidered('torrent',
                                         $(this).text(),
                                         category.name,
                                         $(this).attr('href'),
                                         SpideredStates.ENTITY_PAGE_PARSING);        
        pageResults.push(torrentDescriptor);           
      }
    });

    var count = 0;

    $("td.row1").each(function(){
      if($(this).attr('id') && $(this).attr('id').match(/row_[0-9]_[0-9]+/)){
        var hoursB = parseFloat($(this).text());
        if(pageResults.length-1 < count){
          logger.warn('dodgy parsing');
        }
        else{
          pageResults[count].date = Date.create().addHours(-hoursB);;
          count += 1;
        }
      }
    });

    count = 0;
    $("td.row3").each(function(){
      if($(this).attr('title') && $(this).attr('title').match(/[0-9]*\sfiles$/)){
        if(pageResults.length-1 < count){
          logger.warn('dodgy parsing');
        }
        else{
          pageResults[count].fileSize = $(this).text();
          console.log('found : ' + pageResults[count].activeLink.uri +
                      ' with ' + pageResults[count].name + '\n and size ' +
                       pageResults[count].fileSize + ' date ' + 
                       pageResults[count].date);      
          count += 1;
        }
      }
    });
    self.driver.sleep(1000 * Number.random(0, 10));
    self.results = self.results.union(pageResults);  
    pageResults = [];  
    // check to make sure we are able to find anything
    // sometimes the cat page is unavailable
    if (self.results.length === 0 && pageNumber === 1){
      done();
      return;
    }

    paginationCount = self.ripPageCount($);

    var haveNotSeen = self.lastRun ? Date.create(self.results.last().date).isAfter(self.lastRun) : true;
    console.log('\n haveNotSeen : ' + haveNotSeen +
                '\n pagecount : ' + paginationCount + 
                '\n pageNumber : ' + pageNumber +
                '\n new results size : ' + self.results.length);
    if (haveNotSeen && pageNumber < paginationCount/20){
      pageNumber += 1;
      var fetchPromise = self.driver.get(self.formatGet(category.id, pageNumber));
      fetchPromise.then(self.parseCategory.bind(self, done, category, pageNumber));
    }
    else{
      logger.info("\n Finished " + category.name + '- results size now is ' + self.results.length);
      done();
    }
    self.driver.sleep(1000 * Number.random(0, 10)/2);
  });
}

/// Parse releases avenue ///////////////////////////////////////////////////
IsoHunt.prototype.parseReleasesCategory = function(done, category, pageNumber){
  var self = this;
  var pageResults = [];
  var paginationCount;

  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    $("td.releases").each(function(){
      var torrentDescriptor;
      if($(this).attr('width') === '60%'){
        torrentDescriptor = new Spidered('torrent',
                                         $(this).children('a').text(),
                                         category.name,
                                         $(this).children('a').attr('href'),
                                         SpideredStates.ENTITY_PAGE_PARSING);
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
    self.driver.sleep(1000 * Number.random(0, 10));
    self.results = self.results.union(pageResults);    
    // check to make sure we are able to find anything
    // sometimes the cat page is unavailable
    if (self.results.length === 0 && pageNumber === 1){
      done();
      return;
    }

    paginationCount = self.ripPageCount($);

    var haveNotSeen = Date.create(pageResults.last().date).isAfter(self.lastRun);
    if (haveNotSeen && pageNumber < paginationCount/8){
      pageNumber += 1;
      var fetchPromise = self.driver.get(self.formatGet(category.id, pageNumber));
      fetchPromise.then(self.parseCategory.bind(self, done, category, pageNumber));
    }
    else{
      logger.info("\n Finished " + category.name + '- results size now is ' + self.results.length);
      done();
    }
  });
}

IsoHunt.prototype.parseReleasePage = function(done, torrent){
  var self = this;
  console.log('parseReleasePage for :' + torrent.name);
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    var found = false;
    // TODO parse multiple links (release pages could have links to x number of torrent links)
    var count = 0;
    $('td.row3').each(function(){
      if(!$(this).attr('id') && count === 0){
        torrent.fileSize = $(this).text();
        count += 1;
      }
    });

    $('a#link1').each(function(){
      try{
        var uri = URI($(this).attr('href'));
        var path = uri.absoluteTo(self.root);
        found = true;
        self.driver.sleep(1000 * Number.random(0, 10));        
        self.emit('link', torrent.constructLink(self, {linkSource: 'torrent RELEASE page'}, path.toString()));
        self.driver.get(path.toString()).then(self.parseTorrentPage.bind(self, done, torrent));
      }        
      catch(err){
        logger.warn('failed to construct uri from link : ' + err);
      }
    });
    // Sometimes the link is not available - usually when it just has been published
    // TODO should we emit here anyway ?
    if(!found){
      torrent.currentState = SpideredStates.END_OF_THE_ROAD;      
      done();
    }
  });
}

IsoHunt.prototype.parseTorrentPage = function(done, torrent){
  var self = this;
  var found = false;
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    $('a#_tlink').each(function(){
      var fileLink = $(this).attr('href');
      self.emit('link', torrent.constructLink(self, {description: 'torrent file link', points: 8}, fileLink));
      //logger.info('Torrent file link for ' + torrent.name + ' - ' + fileLink);
      found = true;
    });
    // scrape the file info data
    $('td.fileRows').each(function(){
      torrent.fileData.push($(this).text());
    });

    $('span#SL_desc').each(function(){
      var tmp = $(this).text().split(' ');
      if(tmp.length > 1){
        var infoHash = 'torrent://' + tmp[1];
        self.emit('link',
                   torrent.constructLink(self,
                                        {description: 'torrent end point',
                                         points: 10,
                                         files: torrent.fileData.join(','),
                                         fileSize: torrent.fileSize,
                                         date: torrent.date},
                                         infoHash));
        //logger.info('info hash for ' + torrent.name + ' - ' + infoHash);
        found &= true;
      }
      else{
        logger.error('Unable to scrape the infoHash !');
      }
    });

    if(found)
      torrent.currentState = SpideredStates.DOWNLOADING;
    else
      torrent.currentState = SpideredStates.END_OF_THE_ROAD;
    done();
  });
}


