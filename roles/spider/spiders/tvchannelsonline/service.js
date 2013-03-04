/*
 * service.js: 
 *
 * (C) 2013 Ayatii Limited
 *
 * Representing a network/station/channel or in BBC speak a 'service'
 * TODO - move to common, rename to Channel
 */
var acquire = require('acquire');
var logger = acquire('logger').forFile('Service.js');
var main = require('./index');

var Service = module.exports =  function(channelType, name, genre, topLink, initialState) { 
  this.init(name, genre, topLink, initialState);
}

Service.prototype.init = function(channelType, name, genre, topLink, initialState) {
  var self = this;

  self.type = channelType;
  self.source = '';

  self.name = name;
  self.genre = genre;  

  self.links = [{uri :topLink, desc: "service link"}];
  // The activeLink member is used to hold the
  // link that is in the process of being requested / parsed
  // so that when we successfully find the next link we know 
  // that the activeLink is its parent.  
  self.activeLink = self.links[0];

  self.currentState = initialState;
  self.lastStageReached = initialState;
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

Service.prototype.isRetired = function(){
  var self= this;
  return self.currentState === main.FancyStreemsStates.END_OF_THE_ROAD;
}

Service.prototype.constructLink = function(childLinkSource, childLink){
  var self = this;
  
  var result = {success: false, link: null};

  if(childLink === undefined || childLink === null){
    return result;
  }
  
  result.success = true;

  result.link = {channel: self.name,
                 genre: self.genre,
                 type: self.type,
                 source: self.source,
                 uri: childLink,
                 parent: self.activeLink.uri,
                 metadata: {linkSource: childLinkSource}};

  self.links.push({desc : childLinkSource, uri : childLink});
  self.moveToNextLink();
  return result;
}