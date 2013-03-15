/*
 * tv-channel.js: 
 * (C) 2013 Ayatii Limited
 *
 * Representing a channel or in BBC radio speak a 'Service', BBC Tv speak 'network'
 * Maybe it's more a generic model so should not be so specificly named. 
 */
var acquire = require('acquire');
var logger = acquire('logger').forFile('TvChannel.js');

require('enum').register();

var TvChannelStates = module.exports.TvChannelStates = new Enum(['CATEGORY_PARSING',
                                                                 'CHANNEL_PARSING',
                                                                 'DETECT_HORIZONTAL_LINKS',
                                                                 'WRANGLE_IT',
                                                                 'END_OF_THE_ROAD']);

var TvChannel = module.exports.TvChannel =  function(channelType, spiderName, name, genre, topLink, initialState) { 
  this.init(channelType, spiderName, name, genre, topLink, initialState);
}

TvChannel.prototype.init = function(channelType, spiderName, name, genre, topLink, initialState) {
  var self = this;

  self.type = channelType;
  self.source = spiderName;

  self.name = name;
  self.genre = genre;  

  self.links = [{uri :topLink, desc: "TvChannel link from target index or category page"}];
  // The activeLink member is used to hold the
  // link that is in the process of being requested / parsed
  // so that when we successfully find the next link we know 
  // that the activeLink is its parent.  
  self.activeLink = self.links[0];
  self.currentState = initialState;
  self.lastStageReached = initialState;
}

TvChannel.prototype.moveToNextLink = function(){
  var self = this;
  var n = self.links.indexOf(self.activeLink);
  if(n < 0){
    logger.error('activeLink is not part of links for some reason for ' + self.name + " : " + JSON.stringify(self.activeLink));
    self.retire();
    return;
  }
  if((n+1) > (self.links.length-1)){
    self.retire();
    logger.error("At the end of the list of links for " + self.name);
    return;
  }
  self.activeLink = self.links[n+1];
}

TvChannel.prototype.retire = function(){
  var self = this;
  self.lastStageReached = self.currentState;
  self.currentState = TvChannelStates.END_OF_THE_ROAD;
}

TvChannel.prototype.isRetired = function(){
  var self= this;
  return self.currentState === TvChannelStates.END_OF_THE_ROAD;
}

TvChannel.prototype.constructLink = function(extraMetadata, childLink){
  var self = this;
  var link;
  
  if(!childLink){
    logger.error('%s - constructLink got passed a null link %s', self.name, extraMetadata);
    return false;
  }

  link = {channel: self.name,
          genre: self.genre,
          type: self.type,
          source: self.source,
          uri: childLink,
          parent: self.activeLink.uri,
          metadata: extraMetadata};
  var archive = Object.clone(extraMetadata);
  archive.uri = childLink;
  self.links.push(archive);
  self.moveToNextLink();
  return link;
}

// Unpack the results from the wrangler and emit accordingly
TvChannel.prototype.wranglerFinished = function(spider, done, items){
  var self = this;

  items.each(function traverseResults(x){
    if(x.parents.length > 0){
      x.parents.reverse();
      x.parents.each(function emitForParent(parent){
        spider.emit('link',
                  self.constructLink({link_source : "An unwrangled parent"}, parent));
      });
    }
    
    var endPoint = null;
    for(var t = 0; t < x.items.length; t++){
      if(x.items[t].isEndpoint){
        endPoint = x.items.splice(t, 1)[0];
        break;
      }
    }
    // Gather all items into one string and put it in the metadata under 'hiddenEndpoint'
    // under direct parent of where the stream is embedded.
    var flattened = x.items.map(function flatten(n){ return n.toString();});
    spider.emit('link',
              self.constructLink({link_source: "final stream parent uri",
              hiddenEndpoint: flattened.join(' , ')}, x.uri));
    
    // Finally emit the endpoint
    if(endPoint){
      spider.emit('link',
                  self.constructLink({link_source: "End of the road"}, endPoint.toString()));  
    }
  });
  spider.channelCompleted(self, items.length > 0);
  spider.wrangler.removeAllListeners();
  done();
}
