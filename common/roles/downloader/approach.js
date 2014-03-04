/*
 * approach.js: 
 *
 * Base class for techniques in downloading.
 * Mangling, FTP'ng, scp'ng, whatever. 
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

var Approach = module.exports = function (campaign, targetHost, done) {
  this.campaign_ = campaign;
  this.host_ = targetHost;
  this.ignoreExts = [];
  this.mimetypes = [];
  this.setupIgnores();
  this.init(done);
};

util.inherits(Approach, events.EventEmitter);

Approach.prototype.setupIgnores = function(){
	var self = this;

	if(self.campaign_.type.match(/movie/)){
	  self.minSize = 10;
	  self.mimetypes = ["video/"];
	  self.ignoreExts.union(['.mp3', '.ape', '.wma', '.m4a', '.wav', '.flac', '.aiff']);
	}
	else{
	  // For music and anything else
	  self.minSize = 1;
	  self.mimetypes = ["video/", "audio/"];
	} 
	// For now We don't care about these at all.
	self.ignoreExts.union(['.png', '.jpg', '.jpeg', '.gif', '.js', '.swf']);
}

// TODO Do we need this anymore ?
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

Approach.prototype.name = function(){
  logger.error("Shouldn't get to here - override me please.");
}
