"use strict";
/*
 * ears.js
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('ears.js')
  , util = require('util')
  , sugar = require('sugar')
  , redis = require("redis")
  , Promise = require('node-promise')
;

var Ears = module.exports = function (channel, done) {
  this.redisClient = null;
  this.channel = null;
  this.sources = [];
  this.init(channel, done);
}

util.inherits(Ears, events.EventEmitter);

/*
  Ears
*/
Ears.prototype.init = function(channel, done)
{
	var self = this;
  self.channel = channel;
  self.redisClient = redis.createClient(config.REDIS_PORT, config.REDIS_HOST, {'auth': config.REDIS_AUTH});
  self.redisClient.auth(config.REDIS_AUTH);

  self.redisClient.on("ready", function () {
    self.open(channel).then(function(){
      self.redisClient.on("message", self.listen.bind(self));
      done();  
    });
  });

  self.redisClient.on("error", function(err){
    logger.info ('just got a mangled redis ' + err);
    done(err);
  });

  self.on('mangledCow', function(err){
    logger.info ('just got a mangled Cow');
    done(err);
  });
}

/*
Subscribe to the Redis channel for this Node.
*/
Ears.prototype.open = function(channel){
  var self = this;
  var promise = new Promise.Promise();
  self.redisClient.on('subscribe', function(channel, count) {
    logger.info("Ears subscribed to " + channel + ", " + count + " total subscriptions");
    promise.resolve();
  });
  self.redisClient.subscribe(channel);
  return promise;
}

/*
UnSubscribe to the Redis channel for this Node.
*/
Ears.prototype.close = function(channel){
  var self = this;
  var promise = new Promise.Promise();
  self.redisClient.on('unsubscribe', function(channel, count) {
    logger.info("Ears unsubscribed to " + channel + ", " + count + " total subscriptions");
    promise.resolve();
  });
  self.redisClient.unsubscribe();
  return promise;
}

/*
Listen to events.
*/
Ears.prototype.listen = function(channel, message){
  var self = this;
  var msg = JSON.parse(message);

  if(self.channel !== channel){
    logger.info("We received a redis message on channel " + channel + " : " +
                message + " \n We are not interested in this channel right now.");  
    return;
  }

  if(!self.sources.some(msg.src_uri) && msg.signal !== 'destroyed')
    return;

  if(msg.signal === 'download-stored'){
    logger.info('dnlds stored : ' + msg.md5 + ' with a mimetype of ' + msg.mimetype +  ' src: ' + msg.src_uri);
    return;
  }

  if(msg.signal === 'download-all-done'){
    logger.info('dlnds all done on uri : ' + msg.src_uri);
    self.flush(msg.downloads, msg.src_uri);
    return;
  }

  if(msg.signal === 'destroyed'){
    logger.info('mangledCow from redis.');
    self.emit('mangledCow', new Error('Cowmangler just runofft'));
  }
  // just log the other actions for now.
  logger.info('Non urgent signal : ' + msg.signal + ' for ' + msg.src_uri);
}

/* Flush the download objects for a given source URI */
Ears.prototype.flush = function(messages, srcUri){
  var self = this;
  
  logger.info('Flush srcUri - ' + srcUri + ' with ' + messages.length + ' downloads');

  var compacted = messages.map(function(msg){
    return {name: msg.uri,
            startTime: msg.timestamp_start,
            endTime: msg.timestamp_finish,
            md5: msg.md5,
            mimetype: msg.mimetype,
            size: msg.size};
  });
  self.sources = self.sources.exclude(srcUri);
  self.emit('finishedDownloading', {uri: srcUri, downloads : compacted});
}
