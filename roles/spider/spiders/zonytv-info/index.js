/*
 * A ZonyTv spider (http://www.tvchannelsliveonline.com/)
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('ZonyTv.js')
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
var ZonyTvStates = module.exports.ZonyTvStates = new Enum(['CATEGORY_PARSING',
                                                                               'SERVICE_PARSING',
                                                                               'WRANGLE_IT',
                                                                               'END_OF_THE_ROAD']);
var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var ZonyTv = module.exports = function() {
  this.init();
}

util.inherits(ZonyTv, Spider);

ZonyTv.prototype.init = function() {
  var self = this;  

  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those services that for some reason didn't find their way to the end
  self.complete = [] // used to store those services which completed to a satisfactory end. 
  
  self.newWrangler();
  self.driver.get("http://www.zonytvcom.info").then(self.parseIndex.bind(self));
}

ZonyTv.prototype.newWrangler = function(){
  var self = this;

  if(self.driver){
    self.driver.quit();
    self.driver = null;
  }
  self.driver = new webdriver.Builder()//.usingServer('http://hoodoo.cloudapp.net:4444/wd/hub')
                                       .withCapabilities(CAPABILITIES)
                                       .build();
  self.driver.manage().timeouts().implicitlyWait(30000);
  self.wrangler = new Wrangler(self.driver);

  self.wrangler.addScraper(acquire('endpoint-wrangler').scrapersLiveTV);
}

ZonyTv.prototype.parseIndex = function(){
  var self = this;
  var pageResults = [];
  var filterLinks = function(){
    console.log('Pageresults size = %s', pageResults.length.toString());

    var serviceName;

    pageResults.each(function makeServices(result){
      if(serviceName === result){
        console.log('make service for %s', result);      
      }
      else{
        serviceName = result;
      }
    });
  }

  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    console.log('print ')
    $('a').each(function(i, elem){
      console.log('here : %s', $(elem).attr('href'));
      pageResults.push($(elem).attr('href'));
    });
    filterLinks();
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

ZonyTv.prototype.iterateRequests = function(collection){
  var self= this;
  Seq(collection)
    .seqEach(function(item){
      var done = this;

      if(item.isRetired()){
        logger.warn('retired item in live loop %s', item.name);
        done();
      }
      else if(item.currentState === ZonyTvStates.SERVICE_PARSING){
        console.log('service mofo parsing for %s @ %s', item.name, item.activeLink.uri);
        self.driver.get(item.activeLink.uri).then(self.scrapeService.bind(self, item, done));
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

ZonyTv.prototype.wranglerFinished = function(service, done, items){
  var self = this;
  items.each(function traverseResults(x){
    if(x.parents.length > 0){
      x.parents.reverse();
      x.parents.each(function emitForParent(parent){
        self.emit('link',
                  service.constructLink({link_source : "An unwrangled parent"}, parent));
      });
    }    

    var endpointDeterminded = false;
    for(var t = 0; t < items.length; t++){
      if(items[t].isEndpoint){
        endpointDeterminded = true;
        break;
      }
    }

    if (!endpointDeterminded){
      // gather all items into one string and put in the metadata under 'hiddenEndpoint'
      var flattened = x.items.map(function flatten(n){ return n.toString();});
      self.emit('link',
                service.constructLink({link_source: "final stream parent uri",
                hiddenEndpoint: flattened.join(',')}, x.uri));
    }
    else{
      // first emit the uri of the frame as the parent of the stream
      self.emit('link', service.constructLink({link_source: "final stream parent uri"}, x.uri));
      x.items.each(function rawBroadcaster(item){
        if(item.isEndpoint){
          self.emit('link', service.constructLink({link_source: "End of the road"}, item.toString()));  
        }
        else{
          self.emit('link', service.constructLink({link_source: "Not an endpoint so what am I ?"}, item.toString()));            
        }
      });
    }
  });
  self.serviceCompleted(service, items.length > 0);
  self.wrangler.removeAllListeners();
  done();
}

ZonyTv.prototype.scrapeService = function(service, done){
  var self = this;
  var $ = null;
  
  console.log('scrape Service');

  function delayedScrape(){
    console.log('delayedScrape');
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
            self.emit('link', service.constructLink({remoteStreamer: "embedded @ service page"}, src));            
            service.currentState = ZonyTvStates.WRANGLE_IT;          
            self.wrangler.on('finished', self.wranglerFinished.bind(self, service, done));
            self.wrangler.beginSearch(service.activeLink.uri);            
          }
        }
      });
      // retire those that didn't manage to move to the right iframe
      if(service.currentState === ZonyTvStates.SERVICE_PARSING){
        self.serviceCompleted(service, false);
        done();
      }
    });
  }
  delayedScrape.delay(1000 * Math.random());
}

ZonyTv.prototype.serviceCompleted = function(service, successfull){
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
