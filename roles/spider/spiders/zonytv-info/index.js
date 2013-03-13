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
  , webdriver = require('selenium-webdriver')
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
  // Not working for some reason. (TODO)
  //var ready = self.driver.manage().deleteAllCookies();
  self.driver.get("http://www.zonytvcom.info").then(self.parseIndex.bind(self));
}

ZonyTv.prototype.newWrangler = function(){
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

ZonyTv.prototype.parseIndex = function(){
  var self = this;
  var pageResults = [];

  var createService = function(name, link){
    if(name.match(/^espn/) === null){
      var service = new Service('tv.live',
                                'ZonyTv',
                                name,
                                "",
                                "http://www.zonytvcom.info/",
                                ZonyTvStates.WRANGLE_IT);
      self.results.push(service);
      self.emit('link', service.constructLink({link_source: "zonytvcom home page"}, link));
    }
  }

  self.driver.getPageSource().then(function parseSrcHtml(source){
    var $ = cheerio.load(source);
    var tmpLinks = [];
    var pageServices = [];
    // first, simply take every second one of each link on the page
    $('a').each(function(i, elem){
      var link = $(elem).attr('href');
      if (tmpLinks.length > 0 && tmpLinks[tmpLinks.length-1] === link){
        pageServices.push(link);
      }
      tmpLinks.push(link);
    });
    var serviceCount = 0;
    // and match it with the text from a td
    // very fragile but good for now (as these things will change)
    $('td').each(function(i, elem){
      var name = $(elem).text().trim().toLowerCase();
      if(pageServices.length > serviceCount)
        createService(name, pageServices[serviceCount]);
      serviceCount ++;
    });
    console.log('results : ' + self.results.length);
    console.log('service : ' + pageServices[pageServices.length -1]);
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
    .seqEach(function(service){
      var done = this;

      if(service.isRetired()){
        logger.warn('retired service in live loop %s', service.name);
        done();
      }
      else if(service.currentState === ZonyTvStates.SERVICE_PARSING){
        console.log('service mofo parsing for %s @ %s', service.name, service.activeLink.uri);
        self.driver.get(service.activeLink.uri).then(self.scrapeService.bind(self, service, done));
      }
      else if(service.currentState === ZonyTvStates.WRANGLE_IT){
        self.wrangler.on('finished', self.wranglerFinished.bind(self, service, done));
        self.wrangler.beginSearch(service.activeLink.uri);                    
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
  var endpointDeterminded = false;

  items.each(function traverseResults(x){
    if(x.parents.length > 0){
      x.parents.reverse();
      x.parents.each(function emitForParent(parent){
        self.emit('link',
                  service.constructLink({link_source : "An unwrangled parent"}, parent));
      });
    }
    
    var endPoint = null;
    for(var t = 0; t < x.items.length; t++){
      endpointDeterminded |= x.items[t].isEndpoint;
      if(x.items[t].isEndpoint){
        endPoint = x.items.splice(t, 1)[0];
        break;
      }
    }
    if (!endpointDeterminded){
      // Gather all items into one string and put it in the metadata under 'hiddenEndpoint'
      // TODO what if there are a number potential hidden Endpoints.
      var flattened = x.items.map(function flatten(n){ return n.toString();});
      self.emit('link',
                service.constructLink({link_source: "final stream parent uri",
                hiddenEndpoint: flattened.join(' , ')}, x.uri));
    }
    else{
      // first emit the uri of the frame as the parent of the stream
      self.emit('link', service.constructLink({link_source: "final stream parent uri"}, x.uri));
      // then emit any items that are not endPoints but are in the items (not sure what they can be)
      x.items.each(function rawBroadcaster(item){
        self.emit('link', service.constructLink({link_source: "Not an endpoint so what am I ?"}, item.toString()));            
      });
      // Finally emit the end point at the END.
      self.emit('link', service.constructLink({link_source: "End of the road"}, endPoint.toString()));  
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
