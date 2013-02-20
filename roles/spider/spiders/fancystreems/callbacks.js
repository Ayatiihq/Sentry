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
  , main = require('./index')  
  , URI = require('URIjs')
;

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

// Don't need this anymore ....
var detectMetaRefresh = function(html, service){
  // firstly ensure its not a meta refresh
  if(html.toString().has('<meta http-equiv="REFRESH"') === true){
    var redirect_to = parse_meta_url(html);
    logger.info("Detected meta refresh for %s @ %s! - go to : %s ", service.name, service.activeLink.uri, redirect_to);
    // request recursively
    return;
  }  
}

// Detect iframe
var scrapeShallowIframe = function(cheerioSource, position){
  var target = null;
  var collection; 
  if(position === undefined){
    collection = cheerioSource('iframe');
  }
  else{
    collection = cheerioSource(position).find('iframe');  
  }
  collection.each(function(i, innerFrame){
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

var scrapeStreamIDAndRemoteJsURI = function(stream_within, service, position){
  //The safest way (I think) to decipher the correct remote js to fetch not by name but where it appears in the DOM
  //Once we see the inline js, set the order to 0 => the next js should be the one that uses the inline vars set in the preceding one 
  var order = -1; 
  var success = false;
  var collection = null;
  if(position === undefined){
    collection = stream_within('script');
  }
  else{
    collection = stream_within(position).find('script');  
  }
  collection.each(function(i, js){
    if(stream_within(js).text().has('fid=')){
      order = 0;
      var js_inline = stream_within(js).text();
      var stream_args = js_inline.split(';')
      stream_args.forEach(function(stream_arg){
        var parts = stream_arg.split('=');
        if(parts.length === 2){
          logger.info('we want this : ' + parts[0] + ' : ' + parts[1] + ' for ' + service.name);
          service.stream_params[parts[0].trim()] = parts[1].replace(/'|"/g, '');
        }
      });
    }
    else if(stream_within(js).attr('src') !== undefined){
      if(order === 0){
        service.stream_params.remote_js = stream_within(js).attr('src');
        logger.info('we want this : ' + stream_within(js).attr('src') + ' for ' + service.name);
        order = 1;
      }
    }
  });
  if(order === 1){
    success = true
  }
  return success;
}

var scrapeRemoteJS = function(source, service, position){
  var collection = null;
  var found = false;
  if(position === undefined){
    collection = source('script');
  }
  else{
    collection = source(position).find('script');  
  }  

  collection.each(function(i, js){
    if(source(js).attr('src') !== undefined){
      if(found === false){
        service.stream_params.remote_js = source(js).attr('src');
        logger.info('we want this : ' + source(js).attr('src') + ' for ' + service.name);
        found = true;
        service.currentState = main.FancyStreemsStates.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST;    
      }
    }
  });
  return found;
}

// Sometimes streams are just a linked with target = _blank directly in the page
// Identified by being an the first alink in the container and having an child img
// with 'play' in the source. 
var scrapeRemoteALinked = function(source, service, position){
  var collection = null;
  if(position === undefined){
    collection = source('a');
  }
  else{
    collection = source(position).find('a');  
  }  
  var results = {success: false, uri: ''};

  collection.each(function(a_index, a_element){
    if(a_index === 0){
      if(source(a_element).attr('target') !== undefined && source(a_element).attr('target') === "_blank"){
        if(source(this).children().length === 1){
          source(this).find('img').each(function(y, n){
            if(source(this).attr('src').match(/play/g) !== null){
              results.success = true;
            }
          });
          if(results.success === true){
            results.uri = source(this).attr('href');
          }
        }
      }
    }
  }); 
  return results;
}

var scrapeEmbed =  function(source, service, position){
  
  var collection = null;
  if(position === undefined){
    collection = source('embed');
  }
  else{
    collection = source(position).find('embed');  
  }    

  result = {success: false, data:{uri: '', type: ''}};
  collection.each(function(i, innerEmbed){
    found_src = true;         
    var srcAttr = parsedHTML(innerEmbed).attr('src');
    //var flashVars = 
    //if()   
  });

}
var scrapeObject = function(source, service, position){
  
  var collection = null;
  if(position === null || position === undefined){
    collection = source('object');
  }
  else{
    collection = source(position).find('object');  
  }    

  result = {success: false, data:{uri: '', type: ''}};
  
  var populated = false;

  collection.find('object').each(function(i, innerObj){
    if(populated === false){
      if(source(innerObj).attr('type') === "application/x-silverlight-2"){
        var source_within = source(innerObj).html().split('mediasource=');
        if(source_within.length === 2){
          var sourceParts = source_within[1].split('"');
          if(sourceParts.length === 2){
            result.success = true;
            result.data.uri = sourceParts[0];
            result.data.type = 'silverlight';
            logger.info("FOUND SILVERLIGHT : " + sourceParts[0]);

            populated = true;
          }
        }
      }
    }
  });
  return result;
}

/// Callbacks for various stages utilizing helper methods above.

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

      //if(name.match(/^star/g) !== null){
        var topLink = self.root + 'tvcat/' + category.cat + 'tv.php';
        var categoryLink = category_index(elem).children().first().attr('href');
        var service = new Service(name, category.cat, topLink, main.FancyStreemsStates.SERVICE_PARSING);

        self.results.push(service);
        self.emit('link', service.constructLink("linked from " + category.cat + " page", categoryLink));
      //}
    }
  });
  //done();
  
  var next = category_index('a#pagenext').attr('href');
  if(next === null || next === undefined || next.isBlank()){
    done();
  }
  else{
    //logger.info('paginate the category at random intervals : ' + cat);
    setTimeout(request, 1000 * Math.random(), next, self.scrapeCategory.bind(self, category, done));    
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
- a js script which directly embeds the flash obj somehow into the dom (in progress).
- TODO refactor this - horrible.        
*/
var scrapeService = function(service, done, err, resp, html)
{
  var self = this;
  if(err){
    logger.error("@service page level Couldn't fetch " + service.activeLink.uri);
    self.serviceCompleted(service, false);
    done();
  }

  var parsedHTML = cheerio.load(html);
  var found_src = false;

  parsedHTML('div .inlineFix').each(function(i, elem){

    if(parsedHTML(elem).children().length === 1){ // We know the embed stream is siblingless !
      
      // Try for the embedded iframe (most common scenario)
      if (found_src === false){
        var res = null;
        res = scrapeShallowIframe.apply(self, [parsedHTML, elem]);
        if (res !== null && res !== undefined){
          found_src = true;
          self.emit('link', service.constructLink("iframe scraped from service page", res));
          service.currentState = main.FancyStreemsStates.DETECT_HORIZONTAL_LINKS;
        }
      }      
      // Embed ??
      if(found_src === false){
        parsedHTML(elem).find('embed').each(function(i, innerEmbed){
          found_src = true;            
          self.emit('link', service.constructLink("direct embed at service page", parsedHTML(innerEmbed).attr('src')));
          self.serviceCompleted(service, true);
        });
      }
      // Object embed ?
      /*if(found_src === false){
        var results = scrapeObject(parsedHTML, service, elem);
        if(results.success === true){
          self.emit('link', service.constructLink(results.data.type + " at service page - end of the road", results.data.uri));
          self.serviceCompleted(service, true);
          logger.info("AT SERVICE LEVEL DETECTED SILVERLIGHT : " + results.data.uri);
          found_src = true;
        }
      }*/
      if(found_src === false){
        parsedHTML(elem).find('object').each(function(i, innerObj){
          if(parsedHTML(innerObj).attr('type') === "application/x-silverlight-2"){
            var source_within = parsedHTML(innerObj).html().split('mediasource=');
            if(source_within.length === 2){
              var source = source_within[1].split('"');
              if(source.length === 2){
                found_src = true;
                source_uri = source[0];
                self.emit('link', service.constructLink("silverlight at service page", source_uri));
                self.serviceCompleted(service, true);
                logger.info("AT SERVICE LEVEL DETECTED SILVERLIGHT : " + source_uri);
              }
            }
          }
        });
      }    
      // handle js
      if(found_src === false){
        var success = false;
        success = scrapeStreamIDAndRemoteJsURI(parsedHTML, service, elem);
        if(success === true){
          found_src = true;
          logger.info("AT SERVICE LEVEL WE HAVE MANAGED TO DETECT A JS for - " + service.name + service.stream_params.remote_js + " " + service.stream_params.fid);
          service.currentState = main.FancyStreemsStates.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST;    
        }
      } 
      
      if(found_src === false){
        var results = scrapeRemoteALinked(parsedHTML, service, elem);
        if(results.success === true){
          //logger.info("RIPPED OUT an a link from the service parsing : " + results.uri);
          self.emit('link', service.constructLink("At service page ripped out <A link", results.uri));
          self.serviceCompleted(service, true);
          found_src = true;
        }
      }

      // last gasp attempt => look for an rtmp link in there
      if(found_src === false){ 
        parsedHTML(elem).find('script').each(function(i, innerScript){
          if(parsedHTML(innerScript).text().match(/rtmp:\/\//g) !== null){
            var makeAStab = parsedHTML(innerScript).text().split('rtmp://');
            if(makeAStab.length > 1){
              var innards = makeAStab[1].split("'");
              if (innards.length > 1){
                found_src = true;
                self.emit('link', service.constructLink("embedded rtmp linked at service page", 'rtmp://' + innards[0]));                
                self.serviceCompleted(service, true);
              }
            }
          }
        });
      }
    }       
  });

  if (found_src === false){
    logger.warn("\n\n Unable to find where to go next from %s service page @ ", service.name, service.activeLink.uri);
    self.serviceCompleted(service, false)
  }   

  done();
}
module.exports.scrapeService = scrapeService;


var scrapeIndividualaLinksOnWindow = function(service, done, err, res, html){
  var self = this;
  if (err || res.statusCode !== 200){
    logger.error("Couldn't fetch iframe for service " + service.name + " @ " + service.activeLink.uri);
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
      var completed_uri = auto_complete_uri(iframe_parsed(this).attr('href'));
      self.emit('link', service.constructLink("alink around png button on the screen", completed_uri));
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
    service.currentState = main.FancyStreemsStates.IFRAME_PARSING;
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
  src = scrapeShallowIframe.apply(self,[embed]);

  if(src !== null && src !== undefined){
    self.emit('link', service.constructLink('relevant iframe scraped', src));
    service.currentState = main.FancyStreemsStates.STREAM_ID_AND_REMOTE_JS_PARSING;
  }
  else{
    var success = false;
    // try for a remote js
    success = scrapeRemoteJS(embed, service);
    if(success === false){
      //  try for a remote alink
      var results = scrapeRemoteALinked(embed, service);
      if(results.success === false){
        self.serviceCompleted(service, false);
      }
      else{
        self.emit('link', service.constructLink('relevant a link scraped', results.link));
        // TODO need to investigate what happens here.
        service.currentState = main.FancyStreemsStates.IFRAME_PARSING;
      }
    }
  }
  done();
}
module.exports.scrapeRemoteStreamingIframe = scrapeRemoteStreamingIframe;


var streamIDandRemoteJsParsingStage = function(service, done, err, resp, html){
  var self = this;  
  if(err || resp.statusCode !== 200){
    logger.error("@streamid and remote js uri stage -  level Couldn't fetch " + service.activeLink.uri);    
    self.serviceCompleted(service, false);
    done();
    return;
  }
  var streamWithin = cheerio.load(html);
  var success = scrapeStreamIDAndRemoteJsURI(streamWithin, service);
  if(success === false){
    self.serviceCompleted(service, false);
  }
  else{
    service.currentState = main.FancyStreemsStates.FETCH_REMOTE_JS_AND_FORMAT_FINAL_REQUEST;    
  }
  done();
}
module.exports.streamIDandRemoteJsParsingStage = streamIDandRemoteJsParsingStage;

var formatRemoteStreamURI = function(service, done, err, resp, html){
  var self = this;

  if(err || resp.statusCode !== 200){
    logger.error("@ fetch remotejs level Couldn't fetch " + service.stream_params.remote_js);    
    self.serviceCompleted(service, false);
    done();
    return;
  }
  var parts = html.split('src=');
  if(parts.length === 2){
    var urlParsed = null;
    var first = false;
    URI.withinString(parts[1], function(url){
      if(first === false){
        urlParsed = url.replace(/"|'|\+/g, '');
        //logger.info("How about %s", url);
      }
    });
    // only append the id if we have one and the url looks like it wants one
    // edge cases where 'fid' is being set but the stream url doesn't need => don't append
    if(service.stream_params.fid !== undefined && urlParsed.endsWith('=') === true){
      service.final_stream_location = urlParsed + service.stream_params.fid;
    }
    else{
      service.final_stream_location = urlParsed; 
    }
    service.referralLink = service.activeLink; 
    self.emit('link', service.constructLink('final location where the stream can be found', service.final_stream_location));
    service.currentState = main.FancyStreemsStates.FINAL_STREAM_EXTRACTION;    
  }
  else{
    logger.warn("Not able to parse remote remote js to figure out path");
    self.serviceCompleted(service, false);
  }
  done();  
}
module.exports.formatRemoteStreamURI = formatRemoteStreamURI;

var scrapeFinalStreamLocation = function(service, done, err, resp, html){
  var self = this;

  if(err || resp.statusCode !== 200){
    logger.error("@end of the road level couldn't fetch " + service.activeLink.uri);    
    self.serviceCompleted(service, false);
    done();
    return;
  }
  var endOfTheRoad = cheerio.load(html);
  var found = false;
  
  // todo this could be more robust
  endOfTheRoad('script').each(function(i, theOne){
    if(endOfTheRoad(theOne).text().trim().has('rtmp://') === true){
      var rtmpAddress = null;
      var fileName = null;
      var rtmpParts = endOfTheRoad(theOne).text().split('streamer');
      if(rtmpParts.length > 1 ){
        rtmpAddress = rtmpParts[1].split(')')[0].replace(/,|'|\s/g, '');
      }
      var fileParts = endOfTheRoad(theOne).text().split("'file',");
      if(fileParts.length > 1){
        fileName = fileParts[1].split(')')[0].replace(/,|'|\s/g, '');
      }
      
      if(rtmpAddress !== null && fileName !== null){
        var theEnd = rtmpAddress + '?file=' + fileName;
        self.emit('link', service.constructLink('The End of the road', theEnd));
        found = true;
      }
    }
  });
  // keep track of success and failures.
  self.serviceCompleted(service, found);
  done();
}
module.exports.scrapeFinalStreamLocation = scrapeFinalStreamLocation;