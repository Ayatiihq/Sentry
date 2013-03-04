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
                                                                               'SERVICE_PARSING',
                                                                               'DETECT_HORIZONTAL_LINKS',
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
  self.emit('finished');
  self.wrangler.quit();
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
      if(item.currentState === TvChannelsOnlineStates.CATEGORY_PARSING){
        self.driver.get(self.root + '/' + item.cat + '-channels').then(self.scrapeCategory.bind(self, item.cat, done));
      }
      else if(item.currentState === TvChannelsOnlineStates.SERVICE_PARSING && item.isRetired() === false){
        request ({uri: item.activeLink.uri, timeout: 5000}, self.scrapeService.bind(self, item, done));
      }
      else if(item.currentState === TvChannelsOnlineStates.DETECT_HORIZONTAL_LINKS && item.isRetired() === false){
        request ({uri: item.activeLink.uri, timeout: 5000}, self.scrapeIndividualaLinksOnWindow.bind(self, item, done));
      }
      else if(item.currentState === TvChannelsOnlineStates.WRANGLE_IT && item.isRetired() === false){
        console.log("\n\n HERE about to begin a wrangler for %s \n\n", item.activeLink.uri);
        self.wrangler.on('finished', self.wranglerFinished.bind(self, item, done));
        self.wrangler.beginSearch(item.activeLink.uri);
      }
      else{
        console.warn('\n\n Shouldnt get to here : %s', JSON.stringify(service));
        self.serviceCompleted(service, false);
      }
    })
    .seq(function(){
      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.complete.length);
      logger.info("InCompleted length : " + self.incomplete.length);
      logger.info("Those with multiple horizontal Links: " + self.horizontallyLinked.length);
      
      // Flatten out any nested links
      if (self.horizontallyLinked.length > 0)
        self.flattenHorizontalLinkedObjects();

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
          var name = $(this).text();
          if(name.match(/^star/)){
            var service = new Service('tv.live',
                                      'TvChannelsOnline',
                                      $(this).text(),
                                      category,
                                      self.root + '/' + category + '-channels',
                                      TvChannelsOnlineStates.SERVICE_PARSING);
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
        self.emit('link', service.constructLink("unwrangled this as a parent", parent));
      });
    }
    self.emit('link', service.constructLink("stream parent uri", x.uri));
    x.items.each(function rawBroadcaster(item){
      self.emit('link', service.constructLink("raw broadcaster ip", item.toString()));  
    });
  });
  self.serviceCompleted(service, items.length > 0);
  self.wrangler.removeAllListeners();
  done();
}

/*
Scrape the individual service pages on FanceStreems. 
Search for a div element with a class called 'inlineFix', check to make sure it has only one child
and then handle all the different ways to embed the stream.
*/
TvChannelsOnline.prototype.scrapeService = function(service, done, err, resp, html)
{
  var self = this;
  if(err){
    logger.warn("@service page level Couldn't fetch " + service.activeLink.uri);
    self.serviceCompleted(service, false);
    done();
  }

  var $ = cheerio.load(html);
  // try for the iframe (+50% of cases)
  var target = null;
  /*$('div .inlineFix').each(function(){
    if($(this).children().length === 1){ // We know the embed stream is siblingless !      
      if($(this).children('iframe').attr('src')){
        target = $(this).children('iframe').attr('src');
      }
    }
  });*/ 
  // if there is an iframe, first step is to check for horizontal links across the top
  if (target){
    //service.currentState = TvChannelsOnlineStates.DETECT_HORIZONTAL_LINKS;
    self.emitLink(service,"iframe scraped from service page", URI(target).absoluteTo('http://tvchannelsonline.com').toString());
  }
  else{
    service.currentState = TvChannelsOnlineStates.WRANGLE_IT;
  }   
  done();
}

TvChannelsOnline.prototype.scrapeIndividualaLinksOnWindow = function(service, done, err, res, html){
  var self = this;
  
  if (err || res.statusCode !== 200){
    logger.warn("scrapeIndividualaLinksOnWindow : Couldn't fetch iframe for service " + service.name + " @ " + service.activeLink.uri);
    self.serviceCompleted(service, false);
    done();
    return;      
  }

  // Best way to identify the actual iframe which have the actual links to the streams
  // is to look for imgs in <a>s  which match /Link[0-9].png/g -
  var iframe_parsed = cheerio.load(html);
  var embedded_results = [];
  iframe_parsed('a').each(function(img_index, img_element){
    var relevant_a_link = false;
    iframe_parsed(this).find('img').each(function(y, n){
      if(iframe_parsed(this).attr('src').match(/Link[0-9].png/g) !== null){
        relevant_a_link = true;
      }
    });
    if(relevant_a_link === true){
      var completed_uri = URI(iframe_parsed(this).attr('href')).absoluteTo('http://TvChannelsOnline.com').toString();
      self.emitLink(service, "alink around png button on the screen", completed_uri);
      embedded_results.push(completed_uri);
    }
  }); 

  // firstly if we found alinks separate these services out from the main pack.
  if(embedded_results.length > 0){
    // we need to handle those with alinks differently => split them out.
    // push them into another array and flatten them out on the next iteration
    service.embeddedALinks = embedded_results
    self.serviceHasEmbeddedLinks(service);
  }
  else{
    // no links at the top ?
    // push it on to iframe parsing where we hope it should work.
    service.currentState = TvChannelsOnlineStates.WRANGLE_IT;
  }
  done();
}


TvChannelsOnline.prototype.sanityCheck = function(){
  var self = this;
  self.results.forEach(function(res){
    console.log("\n\n " +  JSON.stringify(res));
  });
}
/*
  The easiest thing todo is to clone the service object in to however many embedded links we pulled 
  out, reset a few fields and go again. 
*/
TvChannelsOnline.prototype.flattenHorizontalLinkedObjects = function(service, successfull)
{
  var self = this;
  var newResults = [];
  logger.info("flattenHorizontalLinkedObjects initial length : " + self.horizontallyLinked.length);
  logger.info("initial results size = " + self.results.length);

  self.horizontallyLinked.forEach(function(ser){
    ser.embeddedALinks.forEach(function(link){
      var serviceClone = Object.clone(ser);
      serviceClone.links = [];
      serviceClone.embeddedALinks = [];
      serviceClone.links.push({desc: 'starting point', uri: link});
      serviceClone.activeLink = serviceClone.links[0];
      serviceClone.currentState = TvChannelsOnlineStates.WRANGLE_IT;
      newResults.push(serviceClone);
    });
    self.horizontallyLinked.pop(ser);
  });
  self.results = self.results.concat(newResults);
  logger.info("flattenHorizontalLinkedObjects new length : " + self.horizontallyLinked.length);
  logger.info("new results size = " + self.results.length);
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

TvChannelsOnline.prototype.serviceHasEmbeddedLinks = function(service){
  var self = this;

  self.results.each(function(res){
    if(res.activeLink.uri === service.activeLink.uri){
      self.results.splice(self.results.indexOf(res), 1);
    }
  });
  self.horizontallyLinked.push(service);  
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
