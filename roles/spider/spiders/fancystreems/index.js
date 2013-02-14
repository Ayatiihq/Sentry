/*
 * FancyStreems.js: a FancyStreems spider
 *
 * (C) 2013 Ayatii Limited
 *
 * Spider for the infamous Fancystreems
 *
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
  ;

var FANCYSTREEMS_ROOT = "http://fancystreems.com/";

var Spider = acquire('spider');

var FancyStreems = module.exports = function() {
  this.init();
}

util.inherits(FancyStreems, Spider);

FancyStreems.prototype.init = function() {
  var self = this;
  self.results = []; 
  //self.categories = ['news', 'sports', 'music', 'movies', 'entertainment', 'religious', 'kids', 'wildlife'];
  self.categories = ['entertainment'];
  logger.info('FancyStreems Spider up and running');
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
  self.scrapeCategories();
}

FancyStreems.prototype.stop = function() {
  var self = this;
  self.emit('finished');
}

FancyStreems.prototype.isAlive = function(cb) {
  var self = this;

  logger.info('Is alive called');

//  self.emitLink();

  if (!self.alive)
    self.alive = 1;
  else
    self.alive++;

  if (self.alive > 4)
    cb(new Error('exceeded'));
  else
    cb();
}

/*FancyStreems.prototype.emitLink = function() {
  var self = this
    , link = {}
    ;

  link.type = 'tv.live';
  link.uri = 'http://www.example.com/qwe123';
  link.parent = '';
  link.source = 'FancyStreems';
  link.channel = 'neiltv';
  link.genre = 'awesome';
  link.metadata = {};

  self.emit('link', link);
}*/

FancyStreems.prototype.scrapeCategories = function(){
  var self= this;

  Seq(self.categories)
    .seqEach(function(cat){
      var done = this;
      request(FANCYSTREEMS_ROOT + 'tvcat/' + cat + 'tv.php', self.scrapeCategory.bind(self, cat, done));
    })
    .seq(function(){
      logger.info('Finished scraping categories ...');
      //self.scrape_services();
    })    
  ;    
}

FancyStreems.prototype.scrapeCategory = function(cat, done, err, resp, html){
  var self = this;
  if(err || resp.statusCode !== 200){
    done();
    return;
  }      
  category_index = cheerio.load(html);
  category_index('h2').each(function(i, elem){
    if(category_index(elem).hasClass('video_title')){
      
      var name = category_index(this).children().first().text().toLowerCase().trim();
      var topLink = FANCYSTREEMS_ROOT + 'tvcat/' + cat + 'tv.php';
      var categoryLink = category_index(elem).children().first().attr('href');

      logger.info('from category ' +  cat + ' ' + name + ' with link : ' + topLink);
      
      var service = new Service(name,
                                cat,
                                topLink);

      self.results.push(service);
      self.emit('link', service.constructLink("linked from " + cat + " page", categoryLink));
    }
  });
  var next = category_index('a#pagenext').attr('href');
  if(next === null || next === undefined || next.isBlank()){
    done();
  }
  else{
    //logger.info('paginate the category at random intervals : ' + cat);
    setTimeout(request, 10000 * Math.random(), next, self.scrapeCategory.bind(self, cat, done));    
  }
}  
