/*
 * ass.js: the donkey (ass) for cowmangler
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

var MAXTTABIMEOUT = 180000;
var MAXTHUBIMEOUT = 60000;
var MAXATTEMPTS = 3;

var Ass = module.exports = function() {
  this.downloads = [];
  this.tab = null;
  this.hub =  config.COWMANGLER_HUB_ADDRESS + ':' + config.COWMANGLER_HUB_PORT;
  this.init();
}

Ass.prototype.init = function(){}

Ass.prototype.new = function(done){
  var self = this;
  var attempt = 0;
  
  function newTab(){
    self.query('new', {}).then(function(results){
      var targetTab = results.result;
      self.tab = targetTab;
      self.ears = new Ears(self.tab, done);
    },
    function(err){
      if(attempt > MAXATTEMPTS)
        return done(err);
      attempt += 1;
      logger.info("Attempt " + attempt + " failed to create new tab : " + err);
      setTimeout(newTab.bind(), 5000 * attempt);
    });
  }
  newTab();
}

/*
Gateway for all Tab API calls.
*/
Ass.prototype.do = function(action, data){
  var self = this;
  var promise = new Promise.Promise();

  if(!self.tab)
    return promise.reject(new Error("We don't have a Node for the work ??"));

  var api = self.tab + '/' + action;

  request.post({'url' : api, 
                'timeout': MAXTTABIMEOUT,
                'headers' : {'content-type': 'application/json' , 'accept': 'text/plain'},
                'body': JSON.stringify(data)},
                function(err, resp, body){
                  if(err)
                    return promise.reject(err);                  
                  // We might need to be forgiving at the cowmangler level depending on the context
                  // cowmanger will only ever return a 200 or a 500.
                  if(resp.statusCode !== 200){
                    logger.info('Not a 200 - the dump from ass is : ' + JSON.stringify(body));
                    return promise.reject(new Error('action ' + action + ' did not get a 200 response - actual response was : ' + resp.statusCode));
                  }
                  promise.resolve(self.sift(body));
               });
  return promise;
}

/*
Gateway for Hub api calls. 
*/
Ass.prototype.query = function(action){
  var self = this;
  self.headers = {'content-type': 'application/json' , 'accept': 'text/plain'};
  var query =  self.hub + "/" + action;
  logger.info('query ' + query);
  var promise = new Promise.Promise();

  request.get({uri: query, timeout: MAXTHUBIMEOUT}, function(data, response){
    if(!response){
      promise.reject(new Error('No data or response from Hub ...'));
      return;
    }
    var statusCode = response.statusCode;
    if(statusCode !== 200){
      logger.warn('Status code ' + statusCode + ' was returned by CowMangler hub');
      promise.reject(new Error("Didn't get a 200 statusCode back from hub." + statusCode.toString()));
    }
    else{
      promise.resolve(self.sift(response.body));
    }
  });
  return promise;
}

/*
Helper to parse results from hub or tab.
*/
Ass.prototype.sift = function(body){
  try{
    var results = JSON.parse(body);
    if(results)
      return results;
  }
  catch(err){}
}

/*
Add a safety check for relevancy of signals (for given infringement)
*/
Ass.prototype.addSource = function(uri){
  var self = this;
  if(!self.ears.sources[uri]){
    logger.info('adding source to ears for uri : ' + uri);
    self.ears.sources.push(uri);
  }
}

/*
Collect download signals from ears. 
*/
Ass.prototype.getHooverBag = function(uri){
  var self = this;
  var promise = new Promise.Promise();

  self.ears.once('finishedDownloading', function(payLoad){
    logger.info('just received finishedDownloading signal : ' + JSON.stringify(payLoad));
    if(payLoad.uri !== uri)
      logger.warn('was looking for downloads from ' + uri + ' but instead got downloads from ' + payLoad.uri);
    promise.resolve(payLoad.downloads);  
  }); 
  return promise;
}

/*
Close subscriptions to redis channels.
*/
Ass.prototype.deafen = function(){
  return this.ears.close();
}


