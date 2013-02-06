/*
 * clients.js: the client table
 *
 * Wraps the client table, caches the data, listens on the service bus for
 * any cache invalidations.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('queue.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var TABLE = 'clients';

/**
 * Wraps and caches the clients table.
 * 
 * @return {object}
 */
var Clients = module.exports = function() {
  this.tableService_ = null;

  this.init();
}

Clients.prototype.init = function() {
  var self = this;

  self.queueService_ = azure.createTableService(config.AZURE_NETWORK_ACCOUNT,
                                                config.AZURE_NETWORK_KEY);
  self.queueService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn(err);
}

//
// Public Methods
//

