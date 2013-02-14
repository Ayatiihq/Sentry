/*
 * Callbacks.js: the callbacks for the various requests
 * Messy so keep them in the one place away from the main file. 
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , logger = acquire('logger').forFile('FancyStreems.js')
  , cheerio = require('cheerio')
  , sugar = require('sugar')
  , request = require('request')
  , Seq = require('seq')
  , Service = require('./service')
  ;

var FancyStreemsCallbacks = module.exports = function(fs_root) {
  this.init(fs_root);
}

FancyStreemsCallbacks.prototype.init = function(fs_root){
  var self = this;
  self.root = fs_root;
}

FancyStreemsCallbacks.prototype.scrapeCategory = function(cat, done, err, resp, html){
  var self = this;
  if(err || resp.statusCode !== 200){
    done();
    return;
  }      
  category_index = cheerio.load(html);
  category_index('h2').each(function(i, elem){
    if(category_index(elem).hasClass('video_title')){
      
      var name = category_index(this).children().first().text().toLowerCase().trim();
      var topLink = self.root + 'tvcat/' + cat + 'tv.php';
      var categoryLink = category_index(elem).children().first().attr('href');

      //logger.info('from category ' +  cat + ' \n name :' + name + ' with link : ' + topLink);
      
      var service = new Service(name, cat, topLink);

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
    setTimeout(request, 1 * Math.random(), next, self.scrapeCategory.bind(self, cat, done));    
  }
}  
