/*
 * spidered.js: 
 * (C) 2013 Ayatii Limited
 *
 * Representing an entity scraped from a given spidered page
 */
var acquire = require('acquire')
  , logger = acquire('logger').forFile('Spidered.js')
  , links = acquire('links')
  ;
// TODO
// depending on the type autopopulate constructLink's link with the
// key from the relevant schema

require('enum').register();

var SpideredStates = module.exports.SpideredStates = new Enum(['CATEGORY_PARSING',
                                                               'ENTITY_PAGE_PARSING',
                                                               'DETECT_HORIZONTAL_LINKS',
                                                               'WRANGLE_IT',
                                                               'DOWNLOADING',
                                                               'END_OF_THE_ROAD']);

var Spidered = module.exports.Spidered =  function(entityType, name, genre, topLink, initialState) { 
  this.init(entityType, name, genre, topLink, initialState);
}

Spidered.prototype.init = function(entityType, name, genre, topLink, initialState) {
  var self = this;

  self.type = entityType;
  self.name = name;
  self.genre = genre;  
  self.links = [{uri :topLink, desc: "Spidered link from target index or category page"}];
  // The activeLink member is used to hold the
  // link that is in the process of being requested / parsed / whatever
  // the thinking being that when we successfully find the next link we know 
  // that this activeLink is its parent.  
  self.activeLink = self.links[0];
  self.currentState = initialState;
  self.lastStageReached = initialState;
  self.date = null; // when it was published (if available)
  self.fileSize = null; //if applicable
  // Bittorrent related
  self.fileData = [];
  self.magnet;
  self.directLink; // ?
}

Spidered.prototype.moveToNextLink = function(){
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

Spidered.prototype.retire = function(){
  var self = this;
  self.lastStageReached = self.currentState;
  self.currentState = SpideredStates.END_OF_THE_ROAD;
}

Spidered.prototype.isRetired = function(){
  var self= this;
  return self.currentState === SpideredStates.END_OF_THE_ROAD;
}

Spidered.prototype.constructLink = function(spider, extraMetadata, childLink){
  var self = this;
  var link;
  
  if(!childLink){
    logger.error('%s - constructLink got passed a null link %s', self.name, extraMetadata);
    return false;
  }

  extraMetadata.genre = self.genre;

  link = {name: self.name,
          type: self.type,
          source: spider.getName(),
          uri: childLink,
          parent: self.activeLink.uri,
          metadata: extraMetadata};
  // don't pollute the emits (clone metadata and add extra uri for archives)          
  var archive = Object.clone(extraMetadata);
  archive.uri = childLink;
  self.links.push(archive);
  self.moveToNextLink();
  return link;
}

// Unpack the results from the wrangler and emit accordingly
Spidered.prototype.wranglerFinished = function(spider, done, items){
  var self = this;

  items.each(function traverseResults(x){
    if(x.parents.length > 0){
      x.parents.reverse();
      x.parents.each(function emitForParent(parent){
        spider.emit('link',
                  self.constructLink(spider, {link_source : "An unwrangled parent"}, parent));
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
              self.constructLink(spider, {link_source: "final parent uri for the intended target",
              hiddenEndpoint: flattened.join(' , ')}, x.uri));
    
    // Finally emit the endpoint
    if(endPoint){
      spider.emit('link',
                  self.constructLink(spider, {link_source: "End of the road"}, endPoint.toString()));  
    }
  });
  spider.channelCompleted(self, items.length > 0);
  spider.wrangler.removeAllListeners();
  done();
}
