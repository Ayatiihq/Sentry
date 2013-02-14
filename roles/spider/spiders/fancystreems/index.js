/*
 * FancyStreems.js: a FancyStreems spider
 *
 * (C) 2013 Ayatii Limited
 *
 * Spider for the infamous Fancystreems
 * This is just a state-machine.
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
  , Callbacks = require('./callbacks')
  ;

require('enum').register();

var Spider = acquire('spider');

var FancyStreems = module.exports = function() {
  this.init();
}

util.inherits(FancyStreems, Spider);


FancyStreems.prototype.init = function() {
  var self = this;
  self.results = []; 
  self.states = new Enum(['CATEGORY_PARSING', 'SERVICE_PARSING']);
  //self.categories = ['news', 'sports', 'music', 'movies', 'entertainment', 'religious', 'kids', 'wildlife'];
  
  self.root = "http://fancystreems.com/";

  self.categories = ['entertainment']; 
  self.currentState = self.states.get('CATEGORY_PARSING');
  logger.info('FancyStreems Spider up and running');  
  
  var callbacks = new Callbacks(self.root);

  console.log("callbacks prototype = " + JSON.stringify(callbacks));
  
  FancyStreems.prototype.scrapeCategory = callbacks.scrapeCategory;
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
      request (self.constructRequestURI(item), self.fetchAppropriateCallback(item, done));
    })
    .seq(function(){
      logger.info('Finished scraping categories ...');
      self.sanityCheck();
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
  case self.states.get('CATEGORY_PARSING'):
    uri = self.root + 'tvcat/' + item + 'tv.php';
    break;
  }
  if(uri === null)
    self.emit('error', new Error('constructRequestURI : URI is null wtf ! - ' + JSON.stringify(item)));
  logger.info('return URI : ' + uri);
  return uri;
}

FancyStreems.prototype.fetchAppropriateCallback = function(item, done){ 
  var self = this;
  var cb = null;

  switch(this.currentState)
  {
  case self.states.get('CATEGORY_PARSING'):
    cb =  self.scrapeCategory.bind(self, item, done);
    break;
  }

  if(cb === null)
    self.emit('error', new Error('fetchAppropriateCallback : Callback  is null wtf ! - ' + JSON.stringify(item)));

  return cb;
}

