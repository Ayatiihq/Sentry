/*
 * ass.js: the work horse for cowmangler
 *
 * (C) 2013 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('ass.js')
  , sugar = require('sugar')
  , config = acquire('config')
  , util = require('util')
  , utilities = acquire('utilities')
  , request = require('request')
  , Promise = require('node-promise')
  , Ears = require('./ears.js')
  ;

var MAXTIMEOUT = 180000;

var Ass = module.exports = function(done) {
  this.downloads = [];
  this.node = null;
  this.init(done);
}

Ass.prototype.init = function(done){
  var self = this;
  self.headers = {'content-type': 'application/json' , 'accept': 'text/plain'};
  var hub =  config.COWMANGLER_HUB_ADDRESS + ':' + config.COWMANGLER_HUB_PORT + "/new";

  logger.info('hub : ' + hub);  

  request.get(hub, function(data, response){
    if(!response){
      done(new Error('No data or response from cowmangler...'));
      return;
    }
    var statusCode = response.statusCode;
    if(statusCode !== 200){
      logger.warn('Status code ' + statusCode + ' was returned by CowMangler');
      done(new Error("Didn't get a 200 statusCode back from server." + statusCode.toString()));
    }
    else{
      var targetNode = JSON.parse(response.body).result;
      self.node = targetNode;
      self.ears = new Ears(self.node, done);
    }
  });
}

Ass.prototype.addSource = function(uri){
  var self = this;
  if(!self.ears.sources[uri]){
    logger.info('adding source to ears for uri : ' + uri);
    self.ears.sources.push(uri);
  }
}

/*
All rounder communicator with the mangler rest api. 
*/
Ass.prototype.do = function(action, data){
  var self = this;
  var promise = new Promise.Promise();

  if(!self.node)
    return promise.reject(new Error("We don't have a node ?"));

  var api = self.node + '/' + action;

  request.post({'url' : api, 
                'timeout': MAXTIMEOUT,
                'headers' : {'content-type': 'application/json' , 'accept': 'text/plain'},
                'body': JSON.stringify(data)},
                function(err, resp, body){
                  if(err)
                    return promise.reject(err);
                  // We might need to be forgiving at the cowmangler level depending on the context
                  // cowmanger will only ever return a 200 or a 500.
                  if(action === 'click')
                    logger.info('A CLICK to the ass ! : ' + JSON.stringify(body));
                  /*if(action === 'openInfringement')
                    logger.info('A openInfrge response ! : ' + JSON.stringify(resp));*/
                  if(resp.statusCode !== 200){
                    logger.info('Not a 200 - the dump from ass is : ' + JSON.stringify(body));
                    return promise.reject(new Error('action ' + action + ' did not get a 200 response - actual response was : ' + resp.statusCode));
                  }
                  promise.resolve(self.sift(body));
               });
  return promise;
}

Ass.prototype.sift = function(body){
  try{
    var results = JSON.parse(body);
    if(results)
      return results;
  }
  catch(err){}
}

Ass.prototype.getHooverBag = function(uri){
  var self = this;
  var promise = new Promise.Promise();

  self.ears.once('finishedDownloading', function(payLoad){
    logger.info('just received finishedDownloading signal : ' + JSON.stringify(payLoad));
    if(payLoad.uri !== uri)
      logger.warn('was looking for downloads from ' + uri + ' but instead got downloads from ' + payLoad.uri);
      //return promise.reject(new Error('was looking for downloads from ' + uri + ' but instead got downloads from ' + payLoad.uri));
    promise.resolve(payLoad.downloads);  
  }); 
  return promise;
}

Ass.prototype.deafen = function(){
  return this.ears.close();
}

Ass.prototype.poop = function(uri){
  this.ears.flush([], uri);
}