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
  , util = require('util')
  ;

var Seq = require('seq');

var Socket = module.exports = function(server) {
  this.server_ = server;
  this.socketServer_ = null;

  this.init();
}

util.inherits(Socket, events.EventEmitter);

Socket.prototype.init = function() {
  var self = this;

  self.socketServer_ = io.listen(self.server_);

  var clientServer = self.socketServer_.of('/client');
  clientServer.on('connection', self.onClientConnection.bind(self));
}

Socket.prototype.onClientConnection = function(socket) {
  var self = this;

  logger.info('Client connected');

  socket.on('ping', self.ping.bind(self, socket));
  socket.on('getInfo', self.getInfo.bind(self, socket));
  socket.on('getVersion', self.getVersion.bind(self, socket));
  socket.on('getState', self.getState.bind(self, socket));
  
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
      reply(data);
    });
}

Socket.prototype.getState = function(socket, message, reply) {
  var self = this;

  reply({ state: 'unknown' });
}