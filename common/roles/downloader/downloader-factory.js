"use strict";
/*
 * downloader-factory.js
 * (C) 2014 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('downloader.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Mangling = require('./mangling.js')
  , Seq = require('seq')
  , XRegExp = require('xregexp').XRegExp 
  ;

var DownloaderFactory = module.exports = function (campaign, targetHost) {
  this.campaign_ = null;
  this.host_ = null;
  this.approach_ = null;
  this.init();
};
  //This should really only be kicked off when we know the
  //job requires a browser (for now they all do but in future ...)
  self.browser = new Cowmangler();
  self.browser.newTab();
  self.browser.setAdBlock(true);

  self.browser.on('error', function(err){done(err)});


util.inherits(DownloaderFactory, events.EventEmitter);

DownloaderFactory.prototype.init = function(campaign, targetHost){
  var self = this;

  self.campaign_ = campaign;
  self.host_ = targetHost;
  self.ignoreExts = [];
  
  if(self.host_.loginDetails.approach === states.downloaders.method.COWMANGLING){
    self.approach_ = new Mangling(campaign, targetHost);
  }

  if(self.campaign.type.match(/movie/)){
    self.minSize = 10;
    self.mimetypes = ["video/"];
    self.ignoreExts.union(['.mp3', '.ape', '.m4a', '.wav', '.flac', '.aiff']);
  }
  else if(self.campaign.type.match(/music/)){
    self.minSize = 1;
    // Leaving video in there to catch music videos ???
    // we model that ^ scenario more accurately. 
    self.mimetypes = ["video/", "audio/"];
  }
  else{
    logger.warn('Unable to set the minSize or mimetypes - what sort of bloody campaign is this ??' + self.campaign.type);
    // set it anyway.
    self.minSize = 1;
    self.mimetypes = ["video/", "audio/"];
  } 
  // For now We don't care about these at all.
  self.ignoreExts.union(['.png', '.jpg', '.jpeg', '.gif', '.js', '.swf']);
}


DownloaderFactory.prototype.finish = function(done){
  this.browser.quit(done);
}




