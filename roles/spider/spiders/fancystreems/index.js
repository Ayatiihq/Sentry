/*
 * FancyStreems.js: a FancyStreems spider
 *
 * (C) 2013 Ayatii Limited
 *
 * Spider for the infamous Fancystreems
 * This is just a state-machine per service
 * depending on the state of the service certain parsing techniques will be used.

TODO  
 - investigate the service pages (@SERVICE_PARSING) where I don't find anything - more than likely inline js with rtmp addresses passed to remote js - easy.
 - At the point where you are pulling out remote js urls it will  also need to handle inline javascripts which are injecting iframe links into the dom.
 - Match a method for each state - put them in a hash, remove the need for the switch.
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
  , URI = require('URIjs')
  ;

require('enum').register();

var FancyStreemsStates = module.exports.FancyStreemsStates = new Enum(['CATEGORY_PARSING',
                                                                      'SERVICE_PARSING',
                                                                      'DETECT_HORIZONTAL_LINKS',
                                                                      'IFRAME_PARSING',
                                                                      'STREAM_ID_AND_REMOTE_JS_PARSING',
                                                                      'REMOTE_JS_PARSING',
                                                                      'FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST',
                                                                      'FINAL_STREAM_EXTRACTION',
                                                                      'EMBEDDED_LINK_PARSING',
                                                                      'END_OF_THE_ROAD']);

var Spider = acquire('spider');

var FancyStreems = module.exports = function() {
  this.init();
}

util.inherits(FancyStreems, Spider);

FancyStreems.prototype.init = function() {
  var self = this;
  self.results = []; // the working resultset 
  self.incomplete = [] // used to store those services that for some reason didn't find their way to the end
  self.complete = [] // used to store those services which completed to a satisfactory end. 
  // used to store services that have multiple links at a certain level (i.e. those with link 1-5 at the top of the screen)  
  self.horizontallyLinked = [] 
  
  self.root = "http://fancystreems.com/";
  self.embeddedIndex = 0

  self.categories = [{cat: 'entertainment', currentState: FancyStreemsStates.CATEGORY_PARSING},
                     {cat: 'movies', currentState: FancyStreemsStates.CATEGORY_PARSING},
                     {cat: 'sports', currentState: FancyStreemsStates.CATEGORY_PARSING}];

  logger.info('FancyStreems Spider up and running');  
  
  FancyStreems.prototype.scrapeCategory = callbacks.scrapeCategory;
  FancyStreems.prototype.scrapeService = callbacks.scrapeService;
  FancyStreems.prototype.scrapeRemoteStreamingIframe = callbacks.scrapeRemoteStreamingIframe;
  FancyStreems.prototype.scrapeIndividualaLinksOnWindow = callbacks.scrapeIndividualaLinksOnWindow;
  FancyStreems.prototype.scrapeRemoteStreamingIframe = callbacks.scrapeRemoteStreamingIframe;
  FancyStreems.prototype.streamIDandRemoteJsParsingStage = callbacks.streamIDandRemoteJsParsingStage;
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
      if(item.currentState === FancyStreemsStates.END_OF_THE_ROAD){
        logger.error("\n\n Iterate caught a service that was retired : " + JSON.stringify(item));
        self.serviceCompleted(item, false);
        done();
        return;
      }
      //logger.info('request : ' + self.constructRequestURI(item).uri + ' dump : ' + JSON.stringify(item));
      request (self.constructRequestURI(item), self.fetchAppropriateCallback(item, done));
    })
    .seq(function(){
      logger.info('Finished a cycle');
      logger.info("results length : " + self.results.length);
      logger.info("Completed length : " + self.complete.length);
      logger.info("InCompleted length : " + self.incomplete.length);
      logger.info("Those with multiple horizontal Links: " + self.horizontallyLinked.length);
      if (self.horizontallyLinked.length > 0)
        self.flattenHorizontalLinkedObjects();

      if(self.results.length > 0){
        self.iterateRequests(self.results);
      }
      else{
        logger.info("We are finished !");
      }
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

  switch(item.currentState)
  {
  case FancyStreemsStates.CATEGORY_PARSING:
    uri = {uri: self.root + 'tvcat/' + item.cat + 'tv.php', timeout: 5000};
    break;
  case FancyStreemsStates.SERVICE_PARSING:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break;   
  case FancyStreemsStates.DETECT_HORIZONTAL_LINKS:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break; 
  case FancyStreemsStates.IFRAME_PARSING:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break;
  case FancyStreemsStates.STREAM_ID_AND_REMOTE_JS_PARSING:
    uri = {uri: item.activeLink.uri, timeout: 5000};
    break;
  case FancyStreemsStates.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST:
    uri = {uri: item.stream_params.remote_js, timeout: 5000};
    break;
  case FancyStreemsStates.FINAL_STREAM_EXTRACTION:
    var t = new URI(item.stream_params.remote_js);
    //logger.info("for referral use : " + t.domain());
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

  switch(item.currentState)
  {
  case FancyStreemsStates.CATEGORY_PARSING:
    cb =  self.scrapeCategory.bind(self, item, done);
    break;
  case FancyStreemsStates.SERVICE_PARSING:
    cb =  self.scrapeService.bind(self, item, done);
    break;    
  case FancyStreemsStates.DETECT_HORIZONTAL_LINKS:
    cb =  self.scrapeIndividualaLinksOnWindow.bind(self, item, done);
    break;  
  case FancyStreemsStates.IFRAME_PARSING:
    cb =  self.scrapeRemoteStreamingIframe.bind(self, item, done);
    break;
  case FancyStreemsStates.STREAM_ID_AND_REMOTE_JS_PARSING:
    cb = self.streamIDandRemoteJsParsingStage.bind(self, item, done);
    break;        
  case FancyStreemsStates.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST:
    cb = self.formatRemoteStreamURI.bind(self, item, done);
    break;
  case FancyStreemsStates.FINAL_STREAM_EXTRACTION:
    cb = self.scrapeFinalStreamLocation.bind(self, item, done);
    break;
  }

  if(cb === null)
    self.emit('error', new Error('fetchAppropriateCallback : Callback  is null wtf ! - ' + JSON.stringify(item)));
  return cb;
}

/*
  The easiest thing todo is to clone the service object in to however many embedded links we pulled 
  out, reset a few fields and go again. 
*/
FancyStreems.prototype.flattenHorizontalLinkedObjects = function(service, successfull)
{
  var self = this;
  var newResults = [];
  logger.info("flattenHorizontalLinkedObjects initial hl length : " + self.horizontallyLinked.length);
  logger.info("initial results size = " + self.results.length);

  self.horizontallyLinked.forEach(function(ser){
    ser.embeddedALinks.forEach(function(link){
      var serviceClone = Object.clone(ser);
      serviceClone.links = [];
      serviceClone.embeddedALinks = [];
      serviceClone.links.push({desc: 'starting point', uri: link});
      serviceClone.activeLink = serviceClone.links[0];
      serviceClone.currentState = FancyStreemsStates.IFRAME_PARSING;
      newResults.push(serviceClone);
    });
    self.horizontallyLinked.pop(ser);
  });
  self.results = self.results.concat(newResults);
  logger.info("flattenHorizontalLinkedObjects new hl length : " + self.horizontallyLinked.length);
  logger.info("new results size = " + self.results.length);
}

FancyStreems.prototype.serviceCompleted = function(service, successfull){
  var self = this;
  service.retire();

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
    logger.warn("\n\n\nThis service did not complete - " + JSON.stringify(service));
  }
}

FancyStreems.prototype.serviceHasEmbeddedLinks = function(service){
  var self = this;

  var n = self.results.indexOf(service);
  if(n < 0){
    logger.error("We have a service which isn't in results (embedded links) - ", service.name);
    return;
  }
  self.results.splice(n,1);
  self.horizontallyLinked.push(service);  
}