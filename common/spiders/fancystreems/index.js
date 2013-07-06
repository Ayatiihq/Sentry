/*
 * FancyStreems.js: a FancyStreems spider
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('fancystreems/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , request = require('request')
  , sugar = require('sugar')
  , Seq = require('seq')
  , Spidered = acquire('spidered').Spidered 
  , SpideredStates = acquire('spidered').SpideredStates
  , URI = require('URIjs')
  , webdriver = require('selenium-webdriver')
  , Wrangler = acquire('endpoint-wrangler').Wrangler
;

require('enum').register();

var Spider = acquire('spider');
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver' };

var FancyStreems = module.exports = function() {
  this.init();
}

util.inherits(FancyStreems, Spider);

FancyStreems.prototype.init = function() {
  var self = this;  

  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those channels that for some reason didn't find their way to the end
  self.complete = [] // used to store those channels which completed to a satisfactory end. 
  // used to store channels that have multiple links at a certain level (i.e. those with link 1-5 at the top of the screen)  
  self.horizontallyLinked = [] 
  
  self.root = "http://fancystreems.com/";

  self.categories = [{cat: 'entertainment', currentState: SpideredStates.CATEGORY_PARSING},
                     {cat: 'movies', currentState: SpideredStates.CATEGORY_PARSING},
                     {cat: 'sports', currentState: SpideredStates.CATEGORY_PARSING}];
  self.newWrangler();
  self.iterateRequests(self.categories);
}

FancyStreems.prototype.newWrangler = function(){
  var self = this;

  if(self.driver){
    self.driver.quit();
    self.driver = null;
  }
  self.driver = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
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
FancyStreems.prototype.getName = function() {
  return "FancyStreems";
}

FancyStreems.prototype.start = function(state) {
  var self = this;
  self.emit('started');
}

FancyStreems.prototype.stop = function() {
  var self = this;
  self.emit('finished');
  self.wrangler.quit();
}

FancyStreems.prototype.isAlive = function(cb) {
  var self = this;
  cb();
}

FancyStreems.prototype.iterateRequests = function(collection){
  var self= this;

  Seq(collection)
    .seqEach(function(item){
      var done = this;
      if( item instanceof Spidered && item.isRetired()){
        console.warn('\n\n Shouldnt get to here : %s', JSON.stringify(item));
        self.channelCompleted(item, false);
        done();        
      }
      // for the initial stage we just want to request the category pages (don't need selenium)
      else if(item.currentState === SpideredStates.CATEGORY_PARSING){
        request ({uri: self.root + 'tvcat/' + item.cat + 'tv.php', timeout: 5000}, self.scrapeCategory.bind(self, item.cat, done));
      }
      else if(item.currentState === SpideredStates.CHANNEL_PARSING){
        request ({uri: item.activeLink.uri, timeout: 5000}, self.scrapeChannel.bind(self, item, done));
      }
      else if(item.currentState === SpideredStates.DETECT_HORIZONTAL_LINKS){
        request ({uri: item.activeLink.uri, timeout: 5000}, self.scrapeIndividualaLinksOnWindow.bind(self, item, done));
      }
      else if(item.currentState === SpideredStates.WRANGLE_IT){
        console.log("\n\n HERE about to begin a wrangler for %s \n\n", item.activeLink.uri);
        self.wrangler.on('finished', item.wranglerFinished.bind(item, self, done));
        self.wrangler.beginSearch(item.activeLink.uri);
      }
      else{
        console.warn('\n\n Shouldnt get to here : %s', JSON.stringify(item));
        self.channelCompleted(item, false);
        done();                
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

FancyStreems.prototype.scrapeCategory = function(category, done, err, resp, html){
  var self = this;
  if(err || resp.statusCode !== 200){
    done();
    return;
  }      
  category_index = cheerio.load(html);
  category_index('h2').each(function(i, elem){
    if(category_index(elem).hasClass('video_title')){    
      var name = category_index(this).children().first().text().toLowerCase().trim();
      //if(name.match(/^star/g)){
        var topLink = self.root + 'tvcat/' + category + 'tv.php';
        var categoryLink = category_index(elem).children().first().attr('href');
        var channel = new Spidered('tv.live',
                                    name,
                                    category,
                                    topLink,
                                    SpideredStates.CHANNEL_PARSING);
        self.emit('link', channel.constructLink(self, {link_source : category + " page"}, categoryLink));
        self.results.push(channel);
      //}
    }
  });
  //done()
  var next = category_index('a#pagenext').attr('href');
  if(next === null || next === undefined || next.isBlank()){
    done();
  }
  else{
    request.delay(10000 * Math.random(), next, self.scrapeCategory.bind(self, category, done));
  }
}  

/*
Scrape the individual channel pages on FanceStreems. 
Search for a div element with a class called 'inlineFix', check to make sure it has only one child
and then handle all the different ways to embed the stream.
*/
FancyStreems.prototype.scrapeChannel = function(channel, done, err, resp, html)
{
  var self = this;
  if(err){
    logger.warn("@channel page level Couldn't fetch " + channel.activeLink.uri);
    self.channelCompleted(channel, false);
    done();
  }

  var $ = cheerio.load(html);
  // try for the iframe (+50% of cases)
  var target = null;
  $('div .inlineFix').each(function(){
    if($(this).children().length === 1){ // We know the embed stream is siblingless !      
      if($(this).children('iframe').attr('src')){
        target = $(this).children('iframe').attr('src');
      }
    }
  }); 
  // if there is an iframe, first step is to check for horizontal links across the top
  if (target){
    channel.currentState = SpideredStates.DETECT_HORIZONTAL_LINKS;
    // TODO: just for testing, skip the flattening.
    //channel.currentState = SpideredStates.WRANGLE_IT;
    self.emit('link',
              channel.constructLink(self, {link_source : 'channel page'}, URI(target).absoluteTo('http://fancystreems.com').toString()));
  }
  else{
    // Note:
    // Ideally we should try to unwrangle at this point.
    // for some reason it craps out because the wrangler
    // is trying to be used by two different channels
    //channel.currentState = SpideredStates.WRANGLE_IT;
    // for now retire the network - TODO - figure out.
    self.channelCompleted(channel, false);    
  }   
  done();
}

FancyStreems.prototype.scrapeIndividualaLinksOnWindow = function(channel, done, err, res, html){
  var self = this;
  
  if (err || res.statusCode !== 200){
    logger.warn("scrapeIndividualaLinksOnWindow : Couldn't fetch iframe for channel " + channel.name + " @ " + channel.activeLink.uri);
    self.channelCompleted(channel, false);
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
      var completed_uri = URI(iframe_parsed(this).attr('href')).absoluteTo('http://fancystreems.com').toString();
      self.emit('link',
                channel.constructLink(self, {link_source : "alink around png button on the screen"}, completed_uri));
      embedded_results.push(completed_uri);
    }
  }); 

  // firstly if we found alinks separate these channels out from the main pack.
  if(embedded_results.length > 0){
    // we need to handle those with alinks differently => split them out.
    // push them into another array and flatten them out on the next iteration
    channel.embeddedALinks = embedded_results
    self.channelHasEmbeddedLinks(channel);
  }
  else{
    // no links at the top ?
    // push it on to iframe parsing where we hope it should work.
    channel.currentState = SpideredStates.WRANGLE_IT;
  }
  done();
}


FancyStreems.prototype.sanityCheck = function(){
  var self = this;
  self.results.forEach(function(res){
    console.log("\n\n " +  JSON.stringify(res));
  });
}
/*
  The easiest thing todo is to clone the channel object in to however many embedded links we pulled 
  out, reset a few fields and go again. 
*/
FancyStreems.prototype.flattenHorizontalLinkedObjects = function(channel, successfull)
{
  var self = this;
  var newResults = [];
  //logger.info("flattenHorizontalLinkedObjects initial length : " + self.horizontallyLinked.length);
  //logger.info("initial results size = " + self.results.length);

  self.horizontallyLinked.forEach(function(ser){
    ser.embeddedALinks.forEach(function(link){
      var channelClone = Object.clone(ser);
      channelClone.links = [];
      channelClone.embeddedALinks = [];
      channelClone.links.push({desc: 'starting point', uri: link});
      channelClone.activeLink = channelClone.links[0];
      channelClone.currentState = SpideredStates.WRANGLE_IT;
      newResults.push(channelClone);
    });
    self.horizontallyLinked.splice(self.horizontallyLinked.indexOf(ser),1);
  });
  self.results = self.results.concat(newResults);
  //logger.info("flattenHorizontalLinkedObjects new length : " + self.horizontallyLinked.length);
  //logger.info("new results size = " + self.results.length);
}

FancyStreems.prototype.channelCompleted = function(channel, successfull){
  var self = this;
  channel.retire();  
  if(successfull === true){
    self.complete.push(channel);
  } 
  else{
    self.incomplete.push(channel);      
    logger.warn("\n\n\nThis channel did not complete - " + JSON.stringify(channel));
  }

  self.results.each(function(res){
    if(res.activeLink.uri === channel.activeLink.uri){
      self.results.splice(self.results.indexOf(res), 1);
    }
  });
}

FancyStreems.prototype.channelHasEmbeddedLinks = function(channel){
  var self = this;

  self.results.each(function(res){
    if(res.activeLink.uri === channel.activeLink.uri){
      self.results.splice(self.results.indexOf(res), 1);
    }
  });
  self.horizontallyLinked.push(channel);  
}
