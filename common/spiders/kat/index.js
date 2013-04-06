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
  self.maxPage = 20;
  self.results = [];
  self.completed = [];
  self.incomplete = [];

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
  return result;
}

Kat.prototype.parseCategory = function(done, category, pageNumber){
  var self = this;
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    // Wouldn't it be great if cherrio supported proper xpath querying.
    function testAttr($$, attrK, test){
      if(!$$(this).attr(attrK))
        return false;
      if(test instanceof RegExp){
        return $$(this).attr(attrK).match(test);
      }
      return $$(this).attr(attrK) === test;
    }

    $('tr').each(function(){
      var magnet = null;
      var fileLink = null;
      var torrentName = null;
      var size = null;
      var entityLink = null;
      var date = null;

      if($(this).attr('id') && $(this).attr('id').match(/torrent_music_torrents[0-9]+/)){
        $(this).find('a').each(function(){
          if(testAttr.call(this, $, 'title', 'Torrent magnet link'))
            magnet = $(this).attr('href');
          if(testAttr.call(this, $, 'title', 'Download torrent file'))
            fileLink = $(this).attr('href');
          if(testAttr.call(this, $, 'class', /^torType (undefined|movie|film|music)Type$/)){
            try{
              var inst = URI($(this).attr('href'));
              entityLink = inst.absoluteTo(self.root).toString();
            }
            catch(err){
              logger.warn('failed to create valid entity link : ' + err);
            }
          }
          if(testAttr.call(this, $, 'class', 'normalgrey font12px plain bold'))
            torrentName = $(this).text();
        });
        // grab the size and figure out the date.
        $(this).find('td').each(function(){
          if(testAttr.call(this, $, 'class', 'nobr center')){
            size = $(this).text();
            var age = $(this).next().next().text().trim();
            var isMinutes = age.match(/min\./);
            var offset;
            age.words(function(word){
              if(parseInt(word)) 
                offset = word;
            })            
            date = isMinutes ? Date.create().addMinutes(-offset) : Date.create().addHours(-offset);
            //logger.info('age :' + age + '\nisMinutes : ' + isMinutes  + '\noffset : ' + offset + '\nDate : ' + date);
          }
        });

        if(magnet && entityLink && torrentName){
          
          var torrent =  new Spidered('torrent',
                                       torrentName,
                                       category.name,
                                       entityLink,
                                       SpideredStates.ENTITY_PAGE_PARSING);              
          torrent.magnet = magnet;
          torrent.fileSize = size;
          torrent.date = date;
          torrent.directLink = fileLink; // direct link to torrent via querying torcache
          //if(self.results.length === 0) // test with just the first (sort out sleep)
          self.results.push(torrent);
        }
        else{
          logger.warn('fail to create : ' + magnet + '\n' + entityLink + '\n' + torrentName);
          self.incomplete.push({magnet: magnet,
                                fileSize: size,
                                date: date,
                                file: fileLink,
                                name: torrentName,
                                link: entityLink});
        }
        if(pageNumber < self.maxPage){
          pageNumber += 1;
          self.driver.sleep(2000);
          self.driver.get(self.formatGet(category.name,pageNumber)).then(
            self.parseCategory.bind(self, done, category, pageNumber));
        }
        else{
          done();
        }
      }
    });
  });
}

Kat.prototype.parseTorrentPage = function(done, torrent){
  var self = this;
  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    var haveFiles = false;
    // do you need to iterate - cheerio lookup API is a bit odd or maybe it's just me.
    $('table.torrentFileList tr').each(function(){
      if($('td').hasClass('torFileName') && !haveFiles){
        //TODO: split string on known file extensions.
        torrent.fileData.push($('td.torFileName').text().trim().humanize());
        haveFiles = true;
      }
    });
    $('span').each(function(){
      if($(this).attr('class') && $(this).attr('class') === 'lightgrey font10px'){
        var tmp = $(this).html().trim();
        torrent.hash_ID = 'torrent://' + tmp.split(': ')[1]; 
      }      
    });
    // For now retire
    self.emitTorrentLinks(torrent);
    self.results.splice(self.results.indexOf(torrent), 1);
    self.completed.push(torrent);
    done();
  });
}

Kat.prototype.emitTorrentLinks = function(torrent){
  var self = this;
  self.emit('link', 
            torrent.constructLink(self,
                                  {description: 'torrent file link',
                                   points: 8,
                                   fileSize: torrent.fileSize,
                                   date: torrent.date},
                                   torrent.directLink));
  self.emit('link',
             torrent.constructLink(self,
                                  {description: 'torrent end point',
                                   points: 10,
                                   files: torrent.fileData.join(','),
                                   fileSize: torrent.fileSize,
                                   date: torrent.date},
                                   torrent.hash_ID));
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
        if(torrent.currentState === SpideredStates.ENTITY_PAGE_PARSING){
          self.driver.get(torrent.activeLink.uri).then(self.parseTorrentPage.bind(self, done, torrent));
        }
      }
      else{
        var category = torrent; 
        self.driver.sleep(5000);// can't seem to get the sleep going on ...
        self.driver.get(self.formatGet(category.name,1)).then(self.parseCategory.bind(self, done, category, 1));
        /*var slept = self.driver.sleep(5000);
        when(slept, self.driver.get(self.formatGet(category.name,1)).then(self.parseCategory.bind(self, done, category, 1)));
        */
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
        /*self.completed.each(function debug(torrent){
          if(torrent instanceof Spidered){
            logger.info('Spidered \nName :' +
                        torrent.name + '\nFileLink : ' +
                        torrent.directLink + '\nMagnet : ' + 
                        torrent.magnet + '\nSize : ' + 
                        torrent.fileSize + '\nEntity link : ' +
                        torrent.activeLink.uri + '\nDate : ' +
                        torrent.date + '\nFileData : ' +
                        torrent.fileData);
          }
        });*/
        self.incomplete.each(function debugIncomplete(failure){
          logger.info('\n Failure : ' + JSON.stringify(failure));            
        });        
        logger.info("completed length : " + self.completed.length);
        logger.info("Incompleted length : " + self.incomplete.length);        
        self.stop();
      }
    })
  ; 
}
