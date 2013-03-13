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
  , qs = require('querystring')
  , sugar = require('sugar')
  ;

var QuarterMaster = require('./quartermaster')
  , Socket = require('./socket')
  ;

var Hub = module.exports = function() {
  this.server_ = null;
  this.socket_ = null;
  this.quartermaster_ = null;

  this.init();
}

Hub.prototype.init = function() {
  var self = this
    , options = {
        key: fs.readFileSync(__dirname + '/hub.key').toString(),
        cert: fs.readFileSync(__dirname + '/hub.crt').toString()
      }
    ;

  self.server_ = https.createServer(options, self.onRequest.bind(self));
  self.socket_ = new Socket(self.server_);
  self.socket_.on('stateChanged', self.onStateChanged.bind(self));

  self.quartermaster_ = new QuarterMaster();

  self.server_.listen(config.HUB_PORT);
}

Hub.prototype.onRequest = function(req, res) {
  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(data) {
      body += data;
      if (body.length > 1e6) {
        req.connection.destroy();
      }
    });
    req.on('end', function() {
      var msg = {};
      try {
        body = qs.parse(body);
        msg = JSON.parse(body.payload);
      } catch (err) {
        logger.warn(err);
      }
      console.log(msg);

      res.writeHead(200);
      res.end();
    });
  }
}

Hub.prototype.onStateChanged = function(state) {
  var self = this;

  self.state_ = state;
}