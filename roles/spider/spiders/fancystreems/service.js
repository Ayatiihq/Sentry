/*
 * service.js: 
 *
 * (C) 2013 Ayatii Limited
 *
 * Representing a network/station/channel or in BBC speak a 'service'
 *
 */
var acquire = require('acquire');

var logger = acquire('logger').forFile('Service.js');

var main = require('./index');


var Service = module.exports =  function(name, genre, topLink, initialState) { 
  this.init(name, genre, topLink, initialState);
}

Service.prototype.init = function(name, genre, topLink, initialState) {
  var self = this;

  self.type = 'tv.live';
  self.source = 'FancyStreems';

  self.name = name;
  self.genre = genre;
  // This property is to hold the links on the screen (via the buttons at the top)
  // kinda ugly but inorder to be effecient we should store these as we find them
  // best place is on the service object itself.
  // When ready these links should be used to create new service objects which we can 
  // then repeat the pattern which went previously.
  self.embeddedALinks = 0;
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
  // An optional holding place to store the args passed to remote js's.
  // usually these are ripped from inline js preceding the inclusion of the remote js.
  self.stream_params= {};
  self.final_stream_location = '';

  self.currentState = initialState;
  self.lastStageReached = initialState;
  self.referralLink = '';

  //logger.info('Just created a service for ' + self.name + " with initialState : " + self.currentState);
}

Service.prototype.isActiveLinkanIframe = function(){
  var self = this;
  return self.activeLink.desc.match(/^iframe/g) !== null;
}

Service.prototype.moveToNextLink = function(){
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

Service.prototype.retire = function(){
  var self = this;
  self.lastStageReached = self.currentState;
  self.currentState = main.FancyStreemsStates.END_OF_THE_ROAD;
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
  self.moveToNextLink();
  return linkToEmit;
}