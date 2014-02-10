/*
 * redis.js: redis connection manager
 *
 * (C) 2014 Ayatii Limited
 *
 * Handles connecting to redis
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , logger = acquire('logger').forFile('redis.js')
  , redis = require('redis')
  ;


var Redis = module.exports = {};

Redis.createClient = function() {
  var client = redis.createClient(config.REDIS_PORT, config.REDIS_HOST);
  client.auth(config.REDIS_AUTH);
  return client;
}