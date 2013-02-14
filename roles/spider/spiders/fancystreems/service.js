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


var Service = module.exports =  function() { 
  this.init();
}

Service.prototype.init = function(name, genre, topLink) {
  var self = this;

  self.type = 'tv.live';
  self.source = 'FancyStreems';

  self.name = name;
  self.genre = genre;
  // The activeLink member is used to hold the
  // link that is in the process of being requested / parsed
  // so that when we successfully find the next link we know 
  // that the activeLink is its parent.  
  self.activeLink = topLink; 
  // links will be used to hold all the links  we have 
  // found against this service, the key should be used to 
  // describe where the link was scraped.
  // TODO : make links a linked list of link objects defined in constructLink
  self.links = [{categoryPage : topLink}];
}

Service.prototype.constructLink = function(childLinkSource, childLink){
  var self = this;

  var linkToEmit = {channel: self.name,
                    genre: self.genre,
                    type: self.type,
                    source: self.source,
                    uri: childLink,
                    parent: self.activeLink,
                    metadata: {linkSource: childLinkSource}};

  self.links.push({childLinkSource : childLink});
  self.activeLink = childLink;

  logger.info("\n\n wtf : " +  linkToEmit.channel);
  
  return linkToEmit;
}