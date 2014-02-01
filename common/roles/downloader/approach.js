/*
 * approach.js: 
 *
 * Base class for techniques in downloading.
 * Mangling, FTPing, scping, whatever. 
 * Best to model on the technique, not the target.
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('approach.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Campaigns = acquire('campaigns')
  , Seq = require('seq')
  ;

var Approach = module.exports = function (campaign, targetHost) {
  this.campaign_ = null;
  this.host_ = null;
  this.ignoreExts = null;
  this.mimetypes = null;
  this.init();
};

util.inherits(Approach, events.EventEmitter);

Approach.prototype.init = (campaign, targetHost){
	var self = this;
	self.campaign_ = campaign;
	self.host_ = targetHost;

	if(self.campaign.type.match(/movie/)){
	  self.minSize = 10;
	  self.mimetypes = ["video/"];
	  self.ignoreExts.union(['.mp3', '.ape', '.wma', '.m4a', '.wav', '.flac', '.aiff']);
	}
	else{
	  // For music.
	  self.minSize = 1;
	  self.mimetypes = ["video/", "audio/"];
	} 
	// For now We don't care about these at all.
	self.ignoreExts.union(['.png', '.jpg', '.jpeg', '.gif', '.js', '.swf']);
}

Approach.prototype.validateExtension = function(uri){
  var self = this;
  var result = true;
  
  // check for useless extensions
  self.ignoreExts.each(function(useless){
    if(uri.endsWith(useless))
      result = false;
  });
  
  return result;
}

Approach.prototype.download = function(infringement, done){
	logger.error("Shouldn't get to here - override me please.");
}
