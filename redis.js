/*
 * redis.js: convenience connection to redis
 *
 * (C) 2012 Ayatii Limited
 *
 */

var redis = require('redis')
  , url = require('url')
  ;

var REDIS_URL = 'redis://redistogo:3d27f7cc29ad29c4415ff3a0508ced73@gar.redistogo.com:9214/';

//
// node-redis is special so you have to connect in a weirder way than normal
//
exports.createAuthedClient = function() {
  var rtg = url.parse(REDIS_URL);
  var client = redis.createClient(rtg.port, rtg.hostname);

  // Node's url doesn't parse the password correctly
  client.auth(rtg.auth.split(':')[1]);

  return client;
}
