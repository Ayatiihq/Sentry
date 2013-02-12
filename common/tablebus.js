/*
 * tablebus.js: the table notification bus
 *
 * Wraps the table notification bus in an easy-to-consume API.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('tablebus.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var Swarm = acquire('swarm');

var TOPIC = 'tables';

var TableBus = function() {
  this.serviceBus_ = null;

  this.init();
}

util.inherits(TableBus, events.EventEmitter);

TableBus.prototype.init = function() {
  var self = this;

  self.serviceBus_ = azure.createServiceBusService(config.AZURE_SERVICE_BUS_CONN_KEY);
  self.serviceBus_.createTopicIfNotExists(TOPIC, function(err) {
    if (err) {
      logger.warn(err);
      return;
    }
    self.setupSubscription();
  });
}

TableBus.prototype.setupSubscription = function() {
  var self = this;

  self.serviceBus_.getSubscription(TOPIC, Swarm.getUID(), function(err, subscription) {
    if (subscription) {
      self.receiveMessage(subscription);
      process.on('exit', self.cleanUpSubscription.bind(self, subscription));
    } else {
      self.serviceBus_.createSubscription(TOPIC, Swarm.getUID(), function(err, subscription) {
        if (err)
          console.warn(err);
        else {
          self.receiveMessage(subscription);
          process.on('exit', self.cleanUpSubscription.bind(self, subscription));
        }
      });
    }
  });
}

TableBus.prototype.receiveMessage = function(subscription) {
  var self = this;

  self.serviceBus_.receiveSubscriptionMessage(TOPIC, Swarm.getUID(), { timeoutIntervalInS: 55 }, function(err, message) {
    
    if (err) {
      logger.warn(err);
      self.emit('error', err);
    }
    else {
      self.emit('message', message);
      self.emit('table:' + message.customProperties.table, message, message.customProperties.action);
      self.emit('to:' + message.customProperties.to, message, message.customProperties.action);
      self.emit('from:' + message.customProperties.from, message, message.customProperties.action);
    }

    self.receiveMessage(subscription);
  });
}

TableBus.prototype.cleanUpSubscription = function(subscription) {
  var self = this;
  self.serviceBus_.deleteSubscription(TOPIC, Swarm.getUID(), function(err) {
    if (err)
      logger.warn('Unable to delete subscription: ' + err);
  });
}

//
// Public Methods
//

/**
 * Sends a message on the table bus.
 *
 * @return    {undefined}
 */
 TableBus.prototype.send = function(table, action, message, to) {
  var self = this
    , data = {}
    ;

  data.body = message ? message : '';
  data.customProperties = {};
  data.customProperties.table = table;
  data.customProperties.action = action;
  data.customProperties.from = Swarm.getUID();
  data.customProperties.to = to ? to : '*';

  self.serviceBus_.sendTopicMessage(TOPIC, data, function(err) { if (err) logger.warn(err); });
 }


 module.exports = exports = new TableBus();