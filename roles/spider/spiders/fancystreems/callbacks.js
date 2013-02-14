/*
 * Callbacks.js: the callbacks for the various requests
 * Messy so keep them in the one place away from the main file. 
 *
 * Please note this/self in all of these functions is the FancyStreems this. 
 * So self below is always the fancystreems object (hence why I call emit etc.)
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

var scrapeCategory = function(category, done, err, resp, html){
  var self = this;
  if(err || resp.statusCode !== 200){
    done();
    return;
  }      
  category_index = cheerio.load(html);
  category_index('h2').each(function(i, elem){
    if(category_index(elem).hasClass('video_title')){
      
      var name = category_index(this).children().first().text().toLowerCase().trim();
      var topLink = self.root + 'tvcat/' + category + 'tv.php';
      var categoryLink = category_index(elem).children().first().attr('href');

      //logger.info('from category ' +  cat + ' \n name :' + name + ' with link : ' + topLink);
      
      var service = new Service(name, category, topLink);

      self.results.push(service);
      self.emit('link', service.constructLink("linked from " + category + " page", categoryLink));
    }
  });
  var next = category_index('a#pagenext').attr('href');
  if(next === null || next === undefined || next.isBlank()){
    done();
  }
  else{
    //logger.info('paginate the category at random intervals : ' + cat);
    setTimeout(request, 10000 * Math.random(), next, self.scrapeCategory.bind(self, category, done));    
  }
}  

module.exports.scrapeCategory = scrapeCategory;

/*
Scrape the individual service pages on FanceStreems. 
Search for a div element with a class called 'inlineFix', check to make sure it has only one child
and then handle all the different ways to embed the stream. They are :
- iframe
- direct embed of a flash object using embed
- a Silverlight direct embed
- a href to a flash object (needs more work)
- a js script which directly embeds the flash obj somehow into the dom (TODO).
- TODO handle the links the different streams at the top of the embed !
- TODO refactor this - horrible.        
*/
var scrapeService = function(service, done, err, resp, html)
{
  var self = this;
  // TODO  we need to error here !
  if(err){
    console.log("Couldn't fetch " + service.activeLink);
    done();
  }

  var parsedHTML = cheerio.load(html);
  var found_src = false;

  parsedHTML('div .inlineFix').each(function(i, elem){
    if(parsedHTML(elem).children().length === 1){ // We know the embed stream is siblingless !

      parsedHTML(elem).find('iframe').each(function(i, innerFrame){
        
        var target = null;
        var embeddedTarget = null;
        if(parsedHTML(innerFrame).attr('src') !== undefined){
          embeddedTarget = parsedHTML(innerFrame).attr('src');
        }
        else if(parsedHTML(innerFrame).attr('SRC') !== undefined){
          embeddedTarget = parsedHTML(innerFrame).attr('SRC');          
        }
        if(embeddedTarget !== undefined && embeddedTarget.startsWith('http')){
          target = embeddedTarget;
        }
        else if(embeddedTarget !== undefined){
          target = "http://www.fancystreems.com/" +  embeddedTarget;
        }
        
        if(target !== null){
          found_src = true;
          self.emit('link', service.constructLink("iframe scraped from service page", target));
        }
      });
      if(found_src === false){
        parsedHTML(elem).find('embed').each(function(i, innerEmbed){
          found_src = true;            
          service.endOfTheRoad();
          self.emit('link', service.constructLink("direct embed at service page", parsedHTML(innerEmbed).attr('src')));
        });
      }

      parsedHTML(elem).find('object').each(function(i, innerObj){
        found_src = true;
        if(parsedHTML(innerObj).attr('type') === "application/x-silverlight-2"){
          var source_within = parsedHTML(innerObj).html().split('mediasource=');
          if(source_within.length === 2){
            var source = source_within[1].split('"');
            if(source.length === 2){
              source_uri = source[0];
              service.endOfTheRoad();
              self.emit('link', service.constructLink("silverlight at service page", source_uri));
            }
          }
        }
      });
      if(found_src === false){ // last gasp attempt => look for an rtmp link in there
        parsedHTML(elem).find('script').each(function(i, innerScript){
          if(parsedHTML(innerScript).text().match(/rtmp:\/\//g) !== null){
            var makeAStab = parsedHTML(innerScript).text().split('rtmp://');
            if(makeAStab.length > 1){
              var innards = makeAStab[1].split("'");
              if (innards.length > 1){
                found_src = true;
                service.endOfTheRoad();
                self.emit('link', service.constructLink("embedded rtmp linked at service page", 'rtmp://' + innards[0]));                
              }
            }
          }
        });
      }

      if (found_src === false){
        service.endOfTheRoad();
        logger.warn("Unable to find where to go next from %s service page @ ", service.name, service.activeLink);
      }   
    }       
  });
  done();
}
module.exports.scrapeService = scrapeService;

