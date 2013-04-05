 /*
 * A Kat spider
 * (C) 2013 Ayatii Limited
 */
require('sugar');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('kat/index.js')
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

var Kat = module.exports = function() {
  this.init();
}

util.inherits(Kat, Spider);

Kat.prototype.init = function() {
  var self = this;  
  self.newDriver();
  self.lastRun;
  self.results = [];
  self.completed = [];
  self.root = "http://www.katproxy.com";

  self.categories = [{name: 'music'}];// for now just do music

  self.settings_ = new Settings('spider.kat');
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
    logger.info(util.format('Kat spider last ran %s', Date.create(from)));
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

Kat.prototype.newDriver = function(){
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

Kat.prototype.formatGet = function(cat, pageNumber){
  var self = this;
  var result = self.root + '/' + cat + '/' + pageNumber + '/?field=time_add&sorder=desc';
  console.log('result : ' + result);
  return result;
}

Kat.prototype.parseCategory = function(done, category, pageNumber){
  var self = this;

  self.driver.getPageSource().then(function parseSrcHtml(source){

    var $ = cheerio.load(source);

    function testAttr($$, attrK, handle){
      return $$(this).attr(attrK) && $$(this).attr(attrK) === handle;
    }

    $('tr').each(function(){
      var magnet = null;
      var fileLink = null;
      var torrentName = null;
      var size = null;

      if($(this).attr('id') && $(this).attr('id').match(/torrent_music_torrents[0-9]+/)){
        $(this).find('a').each(function(){
          if($(this).attr('title'))

          if(testAttr.call(this, $, 'title', 'Torrent magnet link'))
            magnet = $(this).attr('href');

          if(testAttr.call(this, $, 'title', 'Download torrent file'))
            fileLink = $(this).attr('href');
          
          if(testAttr.call(this, $, 'class', 'normalgrey font12px plain bold'))
            torrentName = $(this).text();
        });
        if(magnet && fileLink && torrentName){
          
          logger.info('Created Spidered \n Name :' +
                      torrentName + '\nFileLink : ' +
                      fileLink + '\nMagnet : ' + 
                      magnet + '\nSize : ' + size);
          var torrent =  new Spidered('torrent',
                                       torrentName,
                                       category.name,
                                       fileLink,
                                       SpideredStates.ENTITY_PAGE_PARSING);              
          torrent.magnetLink = magnet;
          torrent.fileSize = size;
        }
        else{
          logger.warn('fail to create : ' + torrentName + '\n' + fileLink + '\n' + magnet);
        }
      }
    }); 
  });
  done();
}

//
// Overrides
//
Kat.prototype.getName = function() {
  return "Kat";
}

Kat.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

Kat.prototype.stop = function() {
  var self = this;
  self.driver.quit();
  self.emit('finished');    
}

Kat.prototype.isAlive = function(cb) {
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

Kat.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(torrent){
      var done = this;
      if (torrent instanceof Spidered){
      }
      else{
        var category = torrent; 
        self.driver.get(self.formatGet(category.name,1)).then(self.parseCategory.bind(self, done, category, 1));
      }
    })
    .seq(function(){
      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.completed.length);
      // if we have more go again
      //if(self.results.length > 0){
        //self.iterateRequests(self.results);
      //}
      //else{
      self.stop();
      //}
    })    
  ;    
}
