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
  , utilities = acquire('utilities')
  , util = require('util')
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
  var self = this;

  if (req.method === 'POST') {
    var body = '';
    req.on('data', function(data) {
      body += data;
      if (body.length > 1e6) {
        req.connection.destroy();
      }
    });
    req.on('end', function() {
      var payload = {};
      try {
        b = qs.parse(body);
        payload = JSON.parse(b.payload);
      } catch (err) {
        logger.warn(err);
      }

      res.writeHead(200);
      res.end();

      if (!payload.ref) {
        logger.warn('Received random POST request: %s', body);
      } else if (payload.ref === 'refs/heads/' + config.HUB_GIT_BRANCH) {
        self.doUpdate(payload);
      } else {
        logger.info('Ignored webhook for %s', payload.ref);
      }
    });
  }
}

Hub.prototype.doUpdate = function(payload) {
  var message = util.format('<b>Hub going down for update to %s in 60 secondsL</b>', payload.after);
  logger.info(message);
  utilities.notify(message);
  setTimeout(process.exit.bind(null, 0), 1000 * 60);
}

Hub.prototype.onStateChanged = function(state) {
  var self = this;

  self.state_ = state;
}