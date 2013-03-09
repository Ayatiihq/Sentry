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
  , logger = acquire('logger').forFile('worker.js')
  , util = require('util')
  ;


var Socket = module.exports = function(server) {
  this.server_ = server;
  this.socketServer_ = null;

  this.init();
}

util.inherits(Socket, events.EventEmitter);

Socket.prototype.init = function() {
  var self = this;

  self.socketServer_ = io.listen(self.server_);

  self.socketServer_.sockets.on('connection', self.onConnection.bind(self));
}

Socket.prototype.onConnection = function(socket) {
  var self = this;

  socket.on('ping', self.ping.bind(self, socket));
  
  socket.on('disconnect', self.onDisconnect.bind(self, socket));
}

Socket.prototype.onDisconnect = function(socket) {
  var self = this;

  console.log('Client disconnected');
}

Socket.prototype.ping = function(socket, message, reply) {
  var self = this;
  console.log('servers');
  reply({ pong: JSON.stringify(message) });
}