/*
 * socket.js: the socket.io hub server
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , io = require('socket.io')
  , logger = acquire('logger').forFile('socket.js')
  , os = require('os')
  , states = acquire('states')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var FluxCapacitor = require('./flux-capacitor')
  , Seq = require('seq')
  ;

var Socket = module.exports = function(server) {
  this.server_ = server;
  this.socketServer_ = null;
  this.fluxCapacitor_ = null;
  
  this.state_ = states.hub.state.RUNNING;
  this.version_ = null;

  this.init();
}

util.inherits(Socket, events.EventEmitter);

Socket.prototype.init = function() {
  var self = this;

  self.fluxCapacitor_ = new FluxCapacitor();

  utilities.getVersion(function(version) {
    self.version_ = version;

    self.socketServer_ = io.listen(self.server_);

    var clientServer = self.socketServer_.of('/client');
    clientServer.on('connection', self.onClientConnection.bind(self));

    var nodeServer = self.socketServer_.of('/node');
    nodeServer.on('connection', self.onNodeConnection.bind(self));

    utilities.notify(util.format('Hub up-and-running on commit <b>%s</b>', 
                     version.shortRevision));
  });
}

Socket.prototype.onClientConnection = function(socket) {
  var self = this;

  logger.info('Client connected');

  socket.on('ping', self.ping.bind(self, socket));
  socket.on('getInfo', self.getInfo.bind(self, socket));
  socket.on('getVersion', self.getVersion.bind(self, socket));
  socket.on('getState', self.getState.bind(self, socket));
  socket.on('setState', self.setState.bind(self, socket));
  
  socket.on('disconnect', self.onClientDisconnect.bind(self, socket));
}

Socket.prototype.onClientDisconnect = function(socket) {
  var self = this;

  logger.info('Client disconnected');
}

Socket.prototype.messageIsValid = function(message) {
  return message.secret === config.HUB_SECRET;
}

Socket.prototype.ping = function(socket, message, reply) {
  var self = this;
  reply({ pong: message });
}

Socket.prototype.getInfo = function(socket, message, reply) {
  var self = this
    , data = {}
    ;

  data.hostname = os.hostname();
  data.type = os.type();
  data.platform = os.platform();
  data.arch = os.arch();
  data.release = os.release();
  data.cpus = JSON.stringify(os.cpus());
  data.uptime = os.uptime();
  data.totalmem = os.totalmem();
  data.freemem = os.freemem();
  data.pid = process.pid;
  data.memoryUsage = JSON.stringify(process.memoryUsage());
  data.processUptime = process.uptime();

  reply(data);
}

Socket.prototype.getVersion = function(socket, message, reply) {
  var self = this;
  
  reply(self.version_);
}

Socket.prototype.getState = function(socket, message, reply) {
  var self = this;

  reply({ state: self.state_ });
}

Socket.prototype.setState = function(socket, message, reply) {
  var self = this;

  self.state_ = message.state;
  self.emit('stateChanged', self.state_);
  self.socketServer_.of('/node').emit('stateChanged', self.state_);

  reply();
}

Socket.prototype.onNodeConnection = function(socket) {
  var self = this;

  logger.info('Node connected');

  socket.on('handshake', self.handshake.bind(self, socket));
  socket.on('announce', self.announce.bind(self, socket));
  socket.on('getWork', self.getWork.bind(self, socket));
  
  socket.on('disconnect', self.onClientDisconnect.bind(self, socket));
}

Socket.prototype.onNodeDisconnect = function(socket) {
  var self = this;

  logger.info('Node disconnected');
  utilities.notify(util.format('Node (<b>%s:%s</b>) disconnected', 
                     address.address, address.port, message.version.shortRevision));
}

Socket.prototype.handshake = function(socket, message, reply) {
  var self = this
    , data = {
        version: self.version_,
        state: self.state_
      }
    ;

  if (!self.messageIsValid(message))
    return reply({ err: 'unauthorized' });

  Seq()
    .seq('getName', function() {
      data.name = 'John Snow';
      this();
    })
    .seq('reply', function() {
      reply(data);
    });
}

Socket.prototype.announce = function(socket, message, reply) {
  var self = this;

  if (!self.messageIsValid(message))
    return reply({ err: 'unauthorized' });

  socket.announce_ = message;
  if (!socket.notified_) {
    var address = socket.handshake.address;
    utilities.notify(util.format('Node (<b>%s:%s</b>) connected running commit <b>%s</b> with capacity <b>%s</b>', 
                     address.address, address.port, message.version.shortRevision, message.capacity));
    socket.notified_ = true;
  }
}

Socket.prototype.getWork = function(socket, message, reply) {
  var self = this;

  self.fluxCapacitor_.getWork(function(work) {
    reply(work);
  });
}