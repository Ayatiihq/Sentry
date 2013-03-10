/*
 * master.js: the master
 *
 * (C) 2012 Ayatii Limited
 *
 * Master talks to the Hub, making sure things are in sync and using the hub
 * to launch the right roles depending on what the system requires.
 *
 */

var acquire = require('acquire')
  , cluster = require('cluster')
  , config = acquire('config')
  , events = require('events')
  , io = require('socket.io-client')
  , logger = acquire('logger').forFile('master.js')
  , os = require('os')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var Master = module.exports = function() {
  this.nodeState_ = states.node.state.RUNNING;
  this.hubState_ = states.hub.state.PAUSED;
  this.version_ = null;
  this.hub_ = null;

  this.init();
}

util.inherits(Master, events.EventEmitter);

Master.prototype.init = function() {
  var self = this;

  utilities.getVersion(function(version) {
    self.version_ = version;
    self.initHubConnection();
  });
}

Master.prototype.initHubConnection = function() {
  var self = this;

  self.hub_ = io.connect(config.HUB_ADDRESS + '/node', { port: config.HUB_PORT, secure: true });
  self.hub_.on('connect', self.onConnection.bind(self));
  self.hub_.on('disconnect', self.onDisconnection.bind(self));
  self.hub_.on('error', self.onError.bind(self));
  self.hub_.on('stateChanged', self.onHubStateChanged.bind(self));
}

Master.prototype.newMessage = function() {
  return { secret: config.HUB_SECRET };
}

Master.prototype.onConnection = function() {
  var self = this;

  logger.info('Connected to Hub, handshaking');

  self.hub_.emit('handshake', self.newMessage(), function(reply) {
    if (reply && reply.version && reply.version.revision === self.version_.revision) {
      logger.info('Handshake successful');
      self.onHubStateChanged(reply.state);
    
    } else {
      logger.warn('Handshake unsuccessful, exiting for update');
      logger.warn(reply)
      process.exit(0);
    }
  });
}

Master.prototype.onDisconnection = function() {
  var self = this;

  logger.warn('Disconnected from Hub');
  self.onHubStateChanged(states.hub.state.PAUSED);
}

Master.prototype.onError = function(err) {
  var self = this;

  logger.warn(err);
  
  logger.info('Trying a reconnect in 60 seconds');
  setTimeout(self.initHubConnection.bind(self), 1000 * 60);
}

Master.prototype.onHubStateChanged = function(state) {
  var self = this;

  self.hubState_ = state;

  logger.info('Hub state changed to', state);
}