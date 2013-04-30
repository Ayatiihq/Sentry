
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

/-------------------------------------------------------------------------/
// Base CyberLocker
/-------------------------------------------------------------------------/
var Cyberlocker = function () {
  events.EventEmitter.call(this);
  var self = this;
};

util.inherits(Cyberlocker, events.EventEmitter);

/-------------------------------------------------------------------------/
// Deriatives
/-------------------------------------------------------------------------/

/* -- 4Shared */
var FourShared = function (infringement) {
  var creditionals = {user: 'conor@ayatii.com',
                      name: 'Conor Curran',
                      password: ''};
  var self = this;
  self.constructor.super_.call(self, infringement);
  self.name = '4Shared';
};

util.inherits(FourShared, Cyberlocker);

/-------------------------------------------------------------------------/
// CyberlockerManager
/-------------------------------------------------------------------------/
var CyberlockerManager= module.exports = function () {
  events.EventEmitter.call(this);
  var self = this;
  self.plugins = ['4shared.com'];
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

  if (cyberLockers.knownDomains.some(URIInfrg.domain()) && self.plugins.some(URIInfrg.domain()))
    return true;

  logger.info('failed to find cyberlocker plugin for ' + URIInfrg.domain())
  return false;
}
