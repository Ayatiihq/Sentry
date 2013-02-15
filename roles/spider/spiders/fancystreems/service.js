/*
 * service.js: 
 *
 * (C) 2013 Ayatii Limited
 *
 * Representing a network/station/channel or in BBC speak a 'service'
 *
 */
var acquire = require('acquire');

var logger = acquire('logger').forFile('Service.js')


var Service = module.exports =  function(name, genre, topLink) { 
  this.init(name, genre, topLink);
}

Service.prototype.init = function(name, genre, topLink) {
  var self = this;

  self.type = 'tv.live';
  self.source = 'FancyStreems';

  self.name = name;
  self.genre = genre;
  // This property is to hold the count links on the screen (via the buttons at the top)
  // kinda ugly but inorder to be effecient we should store these as we find them
  // best place is on the service object itself.
  self.embeddedALinksCount;
  // links will be used to hold all the links  we have 
  // found against this service, the key should be used to 
  // describe where the link was scraped.
  // TODO : make links a linked list of link objects defined in constructLink
  self.links = [{uri :topLink, desc: "service link"}];
  // The activeLink member is used to hold the
  // link that is in the process of being requested / parsed
  // so that when we successfully find the next link we know 
  // that the activeLink is its parent.  
  self.activeLink = self.links[0];
}

Service.prototype.isActiveLinkanIframe = function(){
  var self = this;
  return self.activeLink.desc.match(/^iframe/g) !== null;
}

Service.prototype.moveToNextLink = function(){
  var self = this;
  var n = self.links.indexOf(self.activeLink);
  if(n < 0){
    logger.err('activeLink is not part of links for some reason + ', JSON.stringify(self.activeLink));
    return false;
  }
  if((n+1) > (self.links.length-1)){
    logger.info("At the end of the links for " + self.name);
    return false;
  }
  self.activeLink = self.links[n+1];
}

Service.prototype.constructLink = function(childLinkSource, childLink){
  var self = this;

  var linkToEmit = {channel: self.name,
                    genre: self.genre,
                    type: self.type,
                    source: self.source,
                    uri: childLink,
                    parent: self.activeLink.uri,
                    metadata: {linkSource: childLinkSource}};

  self.links.push({desc : childLinkSource, uri : childLink});

  return linkToEmit;
}