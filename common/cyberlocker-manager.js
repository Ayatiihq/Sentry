
require('sugar');
var acquire = require('acquire')
  , util = require('util')
  , config = acquire('config')
  , events = require('events')  
	, fs = require('fs-extra')
  , logger = acquire('logger').forFile('test4Shared.js')
  , os = require('os')
  , Promise = require('node-promise')
  , path = require('path')
  , request = require('request')
  , URI = require('URIjs')    
  , cyberLockers = acquire('cyberlockers')
  ;

//-------------------------------------------------------------------------/
// Base CyberLocker
//-------------------------------------------------------------------------/
var Cyberlocker = function (handle) {
  events.EventEmitter.call(this);
  var self = this;
  self.name = handle;
};

util.inherits(Cyberlocker, events.EventEmitter);

Cyberlocker.prototype.get = function(infringement){
  throw new Error('Stub!');
}
//-------------------------------------------------------------------------/
// Deriatives
//-------------------------------------------------------------------------/

/* -- 4Shared */
var FourShared = function () {
  var creditionals = {user: 'conor@ayatii.com',
                      name: 'Conor Curran',
                      key: 'e4456725d56c3160ec18408d7e99f096'};
  var self = this;
  self.constructor.super_.call(self, '4shared.com');
};

util.inherits(FourShared, Cyberlocker);

FourShared.prototype.get = function(infringement){

}

//-------------------------------------------------------------------------/
// CyberlockerManager
//-------------------------------------------------------------------------/
var CyberlockerManager= module.exports = function () {
  events.EventEmitter.call(this);
  var self = this;
  self.plugins = [new FourShared()];
};

util.inherits(CyberlockerManager, events.EventEmitter);

CyberlockerManager.prototype.process = function(infringement){
  logger.info('process cyberlocker link for ' + infringement.uri);
}

CyberlockerManager.prototype.canProcess = function(infringement){
  var self = this;
  var URIInfrg;
  try {
    URIInfrg = URI(infringement.uri);
  }
  catch (error) {
    logger.error("Can't create uri from " + infringement.uri); // some dodgy link => move on.
    return false;
  }

  if (cyberLockers.knownDomains.some(URIInfrg.domain()) &&
      self.plugins.map(function(plugin){ return plugin.name }).some(URIInfrg.domain())){
    return true;
  }

  logger.info('failed to find cyberlocker plugin for ' + URIInfrg.domain())
  return false;
}
