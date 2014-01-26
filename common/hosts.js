/*
 * hosts.js: host actions
 *
 * Wraps the host actions.
 *
 * (C) 2012 Ayatii Limited
 *
  { "_id" : "",
    "categories" : [],
    "name" : "",
    "loginDetails" : {},
    "noticeDetails" : { "batch" : true,
                        "batchMaxSize" : 0,
                        "metadata" : { "template" : "dmca",
                                       "to" : "abuse@getindianstuff.org" },
                        "testing" : false,
                        "triggers" : { "minutesSinceLast" : 720 },
                        "type" : "email" },
                        "serverInfo" : { "ipAddress" : "67.228.81.180",
                                         "countryCode" : "US",
                                         "countryName" : "UNITED STATES",
                                         "regionName" : "WASHINGTON",
                                         "cityName" : "SEATTLE",
                                         "zipCode" : "98101",
                                         "latitude" : "47.6062",
                                         "longitude" : "-122.332",
                                         "timeZone" : "-08:00",
                                         "created" : 1388521639153 },
    "uri" : "",
    "created": 0}
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('hosts.js')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq');

/**
 * Wraps the hosts table.
 * 
 * @return {object}
 */
var Hosts = module.exports = function() {
  this.db_ = null;
  this.hosts_ = null;
  this.cache_ = {};
  this.cachedCalls_ = [];

  this.init();
}

Hosts.prototype.init = function() {
  var self = this;

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('hosts', this);
    })
    .seq(function(db, hosts) {
      self.db_ = db;
      self.hosts_ = hosts;
      this();
    })
    .seq(function() {
      self.cachedCalls_.forEach(function(call) {
        call[0].apply(self, call[1]);
      });
      self.cachedCalls_ = [];
    })
    .catch(function(err) {
      logger.warn('Unable to initialise %s', err);
    })
    ;
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

//
// Public Methods
//

/**
 * Gets a host's details
 *
 * @param {object}                   host             The key of the host
 * @param {function(err,details)}    callback         A callback to receive the details, or an error;
*/
Hosts.prototype.get = function(host, callback)
{
  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.get, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.hosts_.findOne({ _id: host }, callback);
}

/**
 * Add a host's details
 *
 * @param {object}                   host             The host object to add
 * @param {function(err,details)}    callback         A callback to receive the details, or an error;
*/
Hosts.prototype.add = function(host, callback)
{
  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  host.created = Date.now();

  self.hosts_.update({ _id: host._id }, { $set: Object.reject(host, '_id') }, { upsert: true }, callback);
}

/**
 * Update a host's details.
 *
 * @param {object}          id         The id for the host.
 * @param {object}          updates    An object containing updates for the host.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Hosts.prototype.update = function(hostId, updates, callback){

  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.update, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;
  
  self.hosts_.update({ _id: hostId }, { $set: updates }, callback);
}

/**
 * Add a category to the categories arry
 *
 * @param {string}          id         The id for the host.
 * @param {int}             category   The int from infrgs.category
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Hosts.prototype.addCategory = function(hostId, category, callback){

  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.addCategory, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  if(!Object.values(states.infringements.category).some(category))
    return callback(new Error('Category needs to be within range of enum'));

  self.hosts_.update({ _id: hostId }, { $push: {categories : category }}, callback);
}

/**
 * Check if we can automatically escalate with this host
 *
 * @param {object}                host           The host which we need to determine if it we can automatically escalate.
 */
Hosts.prototype.shouldAutomateEscalation = function(host)
{
  var noValidDirect = !host.metadata || host.metadata.to.replace(/\s/g,"") === "";
  var validHostedBy = host.hostedBy && host.hostedBy !== "";

  return noValidDirect && validHostedBy;
}

/*
* Fetch a list of hosts' domains filtered by category
* @param {enum}   category   A valid states.infringement.category
* returns an array of the domains of the hosts filtered by category.
*/
Hosts.prototype.getDomainsByCategory = function(category, callback)
{
  var self = this;

  if (!self.hosts_)
    return self.cachedCalls_.push([self.getDomainsByCategory, Object.values(arguments)]);

  if(complete{
    var result = 
    return callback(null, self.cache_[categories].map(function(host){return host._id}));

  self.hosts_.find({'categories' : {$in : [category]}}).toArray(function(err, results){
    if(err)
      return callback(err);
    self.cache_[category] = results;
    var domains  = results.map(function(host){return host._id});
    callback(null, domains);
  });
}

