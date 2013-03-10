/*
 * socket.js: the socket.io hub server
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , exec = require('child_process').exec
  , io = require('socket.io')
  , logger = acquire('logger').forFile('worker.js')
  , os = require('os')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq');

var Socket = module.exports = function(server) {
  this.server_ = server;
  this.socketServer_ = null;
  this.state_ = states.hub.state.RUNNING;

  this.version_ = null;

  this.init();
}

util.inherits(Socket, events.EventEmitter);

Socket.prototype.init = function() {
  var self = this;

  self.socketServer_ = io.listen(self.server_);

  var clientServer = self.socketServer_.of('/client');
  clientServer.on('connection', self.onClientConnection.bind(self));

  var nodeServer = self.socketServer_.of('/node');
  nodeServer.on('connection', self.onNodeConnection.bind(self));
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
  var self = this
    , data = {}
    ;

  Seq()
    .seq('cached', function() {
      if (self.version_)
        reply(self.version_);
      else
        this();
    })
    .seq('log', function() {
      var that = this;
      exec('git log -n1', function(err, stdout, stderr) {
        data.log = stdout;
        that();
      });
    })
    .seq('rev', function() {
      var that = this;
      exec('git rev-parse HEAD', function(err, stdout, stderr) {
        data.rev = stdout.compact();
        that();
      });
    })
    .seq('shortrev', function() {
      var that = this;
      exec('git rev-parse --short HEAD', function(err, stdout, stderr) {
        data.shortRev = stdout.compact();
        that();
      });
    })
    .seq('reply', function() {
      self.version_ = data;
      reply(data);
    });
}

Socket.prototype.getState = function(socket, message, reply) {
  var self = this;

  reply({ state: self.state_ });
}

Socket.prototype.setState = function(socket, message, reply) {
  var self = this;

  self.state_ = message.state;
  self.emit('stateChanged', self.state_);
  io.of('/node').emit('stateChanged', self.state_);

  reply();
}

Socket.prototype.onNodeConnection = function(socket) {
  var self = this;

  logger.info('Node connected');

  socket.on('handshake', self.handshake.bind(self, socket));
  
  socket.on('disconnect', self.onClientDisconnect.bind(self, socket));
}

Socket.prototype.onNodeDisconnect = function(socket) {
  var self = this;

  logger.info('Node disconnected');
}

Socket.prototype.handshake = function(socket, message, reply) {
  var self = this
    , data = {}
    ;

  Seq()
    .seq('getVersion', function() {
      var that = this;
      self.getVersion(socket, '', function(version) {
        data.version = version;
        that();
      });
    })
    .seq('getName', function() {
      data.name = 'John Snow';
      this();
    })
    .seq('reply', function() {
      reply(data);
    });
}