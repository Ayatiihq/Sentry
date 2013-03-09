/*
 * sentry.js: the sentry main loop
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , config = acquire('config')
  , fs = require('fs')
  , https = require('https')
  , logger = acquire('logger').forFile('hub.js')
  , os = require('os')
  , sugar = require('sugar')
  ;

var Socket = require('./socket');

var Hub = module.exports = function() {
  this.server_ = null;
  this.socket_ = null;

  this.init();
}

Hub.prototype.init = function() {
  var self = this
    , options = {
        key: fs.readFileSync(__dirname + '/hub.key').toString(),
        cert: fs.readFileSync(__dirname + '/hub.crt').toString()
      }
    ;

  self.server_ = https.createServer(options);
  self.socket_ = new Socket(self.server_);

  self.server_.listen(config.HUB_PORT);
}