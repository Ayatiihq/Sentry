/*
 * links.js: the links table
 *
 * Wraps the links table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('links.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  , utilities = require('./utilities')
  ;

var COLLECTION = 'links'
  , EDUPLICATE = 11000
  , SCHEMAS = {
    "tv.live": ['uri', 'parent', 'type', 'source', 'channel', 'genre', 'metadata'],
    "music.download": ['uri', 'parent', 'type', 'source', 'artist', 'title', 'genre', 'collection', 'metadata'],
    "torrent": ['uri', 'parent', 'type', 'source', 'metadata']
    }
  ;

/**
 * Wraps the links table.
 * 
 * @return {object}
 */
var Links = module.exports = function() {
  this.links_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Links.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.links_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

function defaultCallback(err) {
  if (err && err.code !== EDUPLICATE)
    logger.warn('Reply Error: %j', err);
}

Links.prototype.isValid = function(link, schema, callback) {
  schema.forEach(function(key) {
    if (link[key] === undefined) {
      callback(new Error('Link object must contain ' + key));
      return false;
    }
  });
  return true;
}

//
// Public Methods
//
/**
 * Add a link.
 *
 * @param  {object}            link        The found link.
 * @param  {function(err,uid)} callback    A callback to receive the uid of the uri, or an error.
 * @return {undefined}
 */
Links.prototype.add = function(link, callback) {
  var self = this;

  if (!self.links_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  if (!self.isValid(link, SCHEMAS[link.type], callback))
    return;

  link.uri = utilities.normalizeURI(link.uri);
  link.parent = utilities.normalizeURI(link.parent);
  link._id = utilities.genLinkKey(JSON.stringify(link));
  link.created = Date.now();

  self.links_.insert(link, function(err) {
    if (!err || err.code === EDUPLICATE)
      callback(null, link._id);
    else
      callback(err);
  });
}


/**
 * Get new links of type #type, from #date.
 *
 * @param {string}                type        The type of link.
 * @param {date}                  from        When to retrieve new links from.
 * @param {number}                limit       Limit the number of results. Anything less than 1 gets up to 1000 matching links.
 * @param {function(err,links)}   callback    Callback to receive links, or error.
 * @return {undefined}
 */
Links.prototype.getLinks = function(type, from, limit, callback) {
  var self = this;

  if (!self.links_)
    return self.cachedCalls_.push([self.getLinks, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var query = {
    type: type,
    created: { $gt: from.getTime() }
  };

  self.links_.find(query).sort({ created: -1 }).limit(limit ? limit : 1000).toArray(callback); 
}