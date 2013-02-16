/*
 * FancyStreems.js: a FancyStreems spider
 *
 * (C) 2013 Ayatii Limited
 *
 * Spider for the infamous Fancystreems
 * This is just a state-machine.

TODO  
 - investigate the service pages (@SERVICE_PARSING) where I don't find anything - more than likely inline js with rtmp addresses passed to remote js - easy.
 - At the point where you are pulling out remote js urls it will  also need to handle inline javascripts which are injecting iframe links into the dom.
 */

var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('FancyStreems.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , sugar = require('sugar')
  , request = require('request')
  , Seq = require('seq')
  , Service = require('./service')
  , callbacks = require('./callbacks')
  ;

require('enum').register();

var Spider = acquire('spider');

var FancyStreems = module.exports = function() {
  this.init();
}

util.inherits(FancyStreems, Spider);

FancyStreems.prototype.init = function() {
  var self = this;
  self.results = []; // initial big dump of 
  self.incomplete = [] // used to store those services that for some reason didn't find their way to the end
  self.complete = [] // used to store those services which completed to a satisfactory end. 
  self.horizontallyLinked = [] // used to store services that have multiple links at a certain level (i.e. those with link 1-5 at the top of the screen)

  self.states = new Enum(['CATEGORY_PARSING',
                          'SERVICE_PARSING',
                          'IFRAME_PARSING',
                          'STREAM_ID_AND_REMOTE_JS_PARSING',
                          'FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST',
                          'FINAL_STREAM_EXTRACTION',
                          'EMBEDDED_LINK_PARSING']);
  
  self.root = "http://fancystreems.com/";
  self.embeddedIndex = 0

  //self.categories = ['news', 'sports', 'movies', 'entertainment'];
  self.categories = ['entertainment', 'movies', 'sports']; 
  self.currentState = self.states.CATEGORY_PARSING;
  logger.info('FancyStreems Spider up and running');  
  
  FancyStreems.prototype.scrapeCategory = callbacks.scrapeCategory;
  FancyStreems.prototype.scrapeService = callbacks.scrapeService;
  FancyStreems.prototype.scrapeIndividualaLinksOnWindow = callbacks.scrapeIndividualaLinksOnWindow;
  FancyStreems.prototype.scrapeRemoteStreamingIframe = callbacks.scrapeRemoteStreamingIframe;
  FancyStreems.prototype.scrapeStreamIDAndRemoteJsURI = callbacks.scrapeStreamIDAndRemoteJsURI;
  FancyStreems.prototype.formatRemoteStreamURI = callbacks.formatRemoteStreamURI;
  FancyStreems.prototype.scrapeFinalStreamLocation = callbacks.scrapeFinalStreamLocation;
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
  self.iterateRequests(self.categories);
}

FancyStreems.prototype.stop = function() {
  var self = this;
  self.emit('finished');
}

FancyStreems.prototype.isAlive = function(cb) {
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

FancyStreems.prototype.iterateRequests = function(collection){
  var self= this;

  Seq(collection)
    .seqEach(function(item){
      var done = this;
      // double check 
      if(item instanceof Service && item.retired === true){
        done();
        return;
      }
      request (self.constructRequestURI(item), self.fetchAppropriateCallback(item, done));
    })
    .seq(function(){
      logger.info('Finished state - ' + self.currentState);
      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.complete.length);
      logger.info("InCompleted length : " + self.incomplete.length);
      logger.info("Those with multiple horizontal Links: " + self.horizontallyLinked.length);

      self.moveOnToNextState();
    })    
  ;    
}

FancyStreems.prototype.sanityCheck = function(){
  var self = this;
  self.results.forEach(function(res){
    console.log("\n\n " +  JSON.stringify(res));
  });
}

FancyStreems.prototype.constructRequestURI = function(item){
  var self = this;
  var uri = null;

  switch(this.currentState)
  {
  case self.states.CATEGORY_PARSING:
    uri = {uri: self.root + 'tvcat/' + item + 'tv.php', timeout: 5000};
    break;
  case self.states.SERVICE_PARSING:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break;    
  case self.states.IFRAME_PARSING:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break;
  case self.states.STREAM_ID_AND_REMOTE_JS_PARSING:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break;
  case self.states.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST:
    uri = {uri: item.stream_params.remote_js, timeout: 5000};
    break;
  case self.states.FINAL_STREAM_EXTRACTION:
    uri = {uri: item.final_stream_location, timeout: 5000, headers: {referer : item.stream_params.remote_js}};
    break;
  }

  if(uri === null)
    self.emit('error', new Error('constructRequestURI : URI is null wtf ! - ' + JSON.stringify(item)));
  return uri;
}

FancyStreems.prototype.fetchAppropriateCallback = function(item, done){ 
  var self = this;
  var cb = null;

  switch(this.currentState)
  {
  case self.states.CATEGORY_PARSING:
    cb =  self.scrapeCategory.bind(self, item, done);
    break;
  case self.states.SERVICE_PARSING:
    cb =  self.scrapeService.bind(self, item, done);
    break;    
  case self.states.IFRAME_PARSING:
    cb =  self.scrapeIndividualaLinksOnWindow.bind(self, item, done);
    break;
  case self.states.STREAM_ID_AND_REMOTE_JS_PARSING:
    cb = self.scrapeStreamIDAndRemoteJsURI.bind(self, item, done);
    break;        
  case self.states.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST:
    cb = self.formatRemoteStreamURI.bind(self, item, done);
    break;
  case self.states.FINAL_STREAM_EXTRACTION:
    cb = self.scrapeFinalStreamLocation.bind(self, item, done);
    break;
  }

  if(cb === null)
    self.emit('error', new Error('fetchAppropriateCallback : Callback  is null wtf ! - ' + JSON.stringify(item)));
  return cb;
}

FancyStreems.prototype.moveOnToNextState = function(){ 
  var self = this;
  var collectionToUse;

  switch(this.currentState)
  {
  case self.states.CATEGORY_PARSING:
    self.currentState = self.states.SERVICE_PARSING;
    break;
  case self.states.SERVICE_PARSING:
    self.currentState = self.states.IFRAME_PARSING;
    break;    
  case self.states.IFRAME_PARSING:
    self.currentState = self.states.STREAM_ID_AND_REMOTE_JS_PARSING;
    break;
  case self.states.STREAM_ID_AND_REMOTE_JS_PARSING:
    self.currentState = self.states.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST;
    break;
  case self.states.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST:
    self.currentState = self.states.FINAL_STREAM_EXTRACTION;
    break;
  case self.states.FINAL_STREAM_EXTRACTION:
    // roll over the embedded links into their own objects and repeat the process.
    if (self.horizontallyLinked.length > 0){
      self.fanOutHorizontalLinkedObjects();
      self.currentState = self.states.IFRAME_PARSING;
    }
    else{
      logger.info('done');
      return;
    }
    break;
  }

  logger.info("Moving on to %s state", self.currentState)
  self.iterateRequests(self.results);
}
/*
  The easiest thing todo is to clone the service object in to however many embedded links we pulled 
  out, reset a few fields and go again. 
*/
FancyStreems.prototype.fanOutHorizontalLinkedObjects = function(service, successfull)
{
  var self = this;
  var new_results = [];
  self.horizontallyLinked.forEach(function(ser){
    ser.embeddedALinks.forEach(function(link){
      var service_clone = Object.clone(ser);
      service_clone.links = [];
      service_clone.embeddedALinks = [];
      service_clone.links.push({desc: 'starting point', uri: link});
      service_clone.activeLink = service_clone.links[0];
      logger.info("created " + JSON.stringify(service_clone));
      new_results.push(service_clone);
    });
  });
  self.results = new_results;
  self.horizontallyLinked = [];
}

FancyStreems.prototype.serviceCompleted = function(service, successfull){
  var self = this;
  service.retired = true;  

  var n = self.results.indexOf(service);
  if(n < 0){
    logger.error("We have a service which isn't in results - ", service.name);
    return;
  }

  self.results.splice(n,1);
  
  if(successfull === true){
    self.complete.push(service);
  } 
  else{
    self.incomplete.push(service);      
    logger.info("This service did not complete - " + JSON.stringify(service));
  }
}

FancyStreems.prototype.serviceHasEmbeddedLinks = function(service){
  var self = this;

  var n = self.results.indexOf(service);
  if(n < 0){
    logger.err("We have a service which isn't in results (embedded links) - ", service.name);
    return;
  }
  self.results.splice(n,1);
  self.horizontallyLinked.push(service);  
}