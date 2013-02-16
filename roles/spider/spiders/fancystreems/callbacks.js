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
      service.moveToNextLink();

    }
  });
  done();
  /*var next = category_index('a#pagenext').attr('href');
  if(next === null || next === undefined || next.isBlank()){
    done();
  }
  else{
    //logger.info('paginate the category at random intervals : ' + cat);
    setTimeout(request, 10000 * Math.random(), next, self.scrapeCategory.bind(self, category, done));    
  }*/
}  

module.exports.scrapeCategory = scrapeCategory;

/*
Scrape the individual service pages on FanceStreems. 
Search for a div element with a class called 'inlineFix', check to make sure it has only one child
and then handle all the different ways to embed the stream. They are :
- iframe
- direct embed of a flash object using embed
- a Silverlight direct embed
- a js script which directly embeds the flash obj somehow into the dom (in progress).
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
          self.serviceCompleted(service, true)
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
              self.serviceCompleted(service, true)
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
                self.serviceCompleted(service, true)
                self.emit('link', service.constructLink("embedded rtmp linked at service page", 'rtmp://' + innards[0]));                
              }
            }
          }
        });
      }
      if (found_src === false){
        self.serviceCompleted(service, false)
        logger.warn("Unable to find where to go next from %s service page @ ", service.name, service.activeLink);
      }   
    }       
  });
  service.moveToNextLink();
  done();
}
module.exports.scrapeService = scrapeService;

var auto_complete_uri = function(path){
  if (path.startsWith("http")) {
    return path;
  }
  else{
    return "http://www.fancystreems.com/" + path;
  }
}

var parse_meta_url = function(meta_markup){
  var parts;
  var inner_parts;

  parts = meta_markup.toString().split('url=');

  if (parts.length === 2){
    inner_parts = parts[1].split(".php");
    if(inner_parts.length == 2){
      console.log('found inner_parts - ' + inner_parts[0] + '.php');
      return inner_parts[0] + '.php'
    }
  }
  logger.err("HMMM Failed to extract URL value from meta refreshed page => scraping failure")
  return null;
}

var scrapeShallowIframe = function(cheerioSource){
  var target = null;
  cheerioSource('iframe').each(function(i, innerFrame){
    var embeddedTarget = null;
    if(target === null){
      if(cheerioSource(innerFrame).attr('src') !== undefined){
        embeddedTarget = cheerioSource(innerFrame).attr('src');
      }
      else if(cheerioSource(innerFrame).attr('SRC') !== undefined){
        embeddedTarget = cheerioSource(innerFrame).attr('SRC');          
      }
      if(embeddedTarget !== undefined && embeddedTarget.startsWith('http')){
        target = embeddedTarget;
      }
      else if(embeddedTarget !== undefined){
        target = "http://www.fancystreems.com/" +  embeddedTarget;
      }
    }
  }); 
  return target;
}

var scrapeIndividualaLinksOnWindow = function(service, done, err, res, html){
  var self = this;
  if (err || res.statusCode !== 200){
    logger.warn("Couldn't fetch iframe for service " + service.name + " @ " + service.activeLink.uri);
    self.serviceCompleted(service, false);
    done();
    return;      
  }
  // firstly ensure its not a meta refresh
  if(html.toString().has('<meta http-equiv="REFRESH"') === true){
    var redirect_to = parse_meta_url(html);
    logger.info("Detected meta refresh for %s @ %s! - go to : %s ", service.name, service.activeLink.uri, redirect_to);
    request(redirect_to, self.scrapeIndividualaLinksOnWindow.bind(self, service, done))
    return;
  }
  else{    
    // Best way to identify the actual iframe which have the actual links to the streams
    // is to look for imgs in <a>s  which match /Link[0-9].png/g -
    var iframe_parsed = cheerio.load(html);
    var embedded_results = []

    iframe_parsed('a').each(function(img_index, img_element){
      var relevant_a_link = false;
      iframe_parsed(this).find('img').each(function(y, n){
        if(iframe_parsed(this).attr('src').match(/Link[0-9].png/g) !== null){
          relevant_a_link = true;
        }
      });
      if(relevant_a_link === true){
        var completed_uri = auto_complete_uri(iframe_parsed(this).attr('href'));
        self.emit('link', service.constructLink("alink around png button on the screen", completed_uri));
        embedded_results.push(completed_uri);
      }
    }); 

    // no links at the top ?
    // => try for shallows iframe
    if(embedded_results.length === 0){
      target = scrapeShallowIframe(iframe_parsed);

      if(target !== null){
        self.emit('link', service.constructLink("iframe scraped from where we expected to see alinked iframe", target));
        embedded_results.push(target);
      }
    }
    // still nothing ? => give up.
    if(embedded_results.length === 0){
      self.serviceCompleted(service, false);
    }
    else{
      service.moveToNextLink();
    }  
  }
  done();
}

module.exports.scrapeIndividualaLinksOnWindow = scrapeIndividualaLinksOnWindow;


var scrapeRemoteStreamingIframe = function(service, done, err, resp, html){
  var self = this;

  if (err || resp.statusCode !== 200){
    self.serviceCompleted(service, false);
    done();
    return;
  }

  var embed = cheerio.load(html);
  var src = null;

  embed('iframe').each(function(p, ifr){
    if(embed(ifr).attr('src') !== undefined){
      src =  embed(ifr).attr('src');
    }
    else if(embed(ifr).attr('SRC') !== undefined){
      src =  embed(ifr).attr('SRC');
    }
  });
  if(src !== null){
    self.emit('link', service.constructLink('iframe src from within iframe from with iframe (ripped from an alink)', src));
    service.moveToNextLink();
  }
  done();
}
module.exports.scrapeRemoteStreamingIframe = scrapeRemoteStreamingIframe;
