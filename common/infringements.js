/*
 * infringements.js: the infringements table
 *
 * Wraps the infringements table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('infringements.js')
  , seq = require('parseq').seq  
  , sugar = require('sugar')
  , URI = require('URIjs')
  , util = require('util')
  ;

var TABLE = 'infringements'
  , PACK_LIST = ['metadata']
  ;

/**
 * Wraps the infringements table.
 * 
 * @return {object}
 */
var Infringements = module.exports = function() {
  this.tableService_ = null;

  this.init();
}

Infringements.prototype.init = function() {
  var self = this;

  self.tableService_ = azure.createTableService(config.AZURE_CORE_ACCOUNT,
                                                config.AZURE_CORE_KEY);
  self.tableService_.createTableIfNotExists(TABLE, function(err) {
    if (err)
      logger.warn(err);
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %s', err);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}

Infringements.normalizeURI = function(uri) {
  var self = this
    , uri = URI(uri)
    ;

  // Make it sane
  uri.normalize();

  // Remove www
  if (uri.subdomain() === 'www')
    uri.subdomain('');

  // Alphabetize the querystring
  var querystring = uri.query();
  if (querystring && querystring.length > 0) {
    // First remove the existing string
    uri.search('');

    // Get the params into something we can sort
    var map = URI.parseQuery(querystring);
    var list = [];
    Object.keys(map, function(key) {
      list.push({ key: key, value : map[key]});
    });

    list = list.sortBy(function(n) {
      var val = n.value;
      if (Object.isArray(val)) {
        n.value = val.sortBy(function(v) {
          return v;
        });
      }
      return n.key;
    });

    //console.log(list);

    list.forEach(function(n) {
      var query = {};
      query[n.key] = n.value;
      uri.addSearch(query);
    });
  }

  return uri.toString();
}

Infringements.prototype.genURIKey = function(name) {
  return Date.utc.create().getTime() + '.' + name;
}

Infringements.prototype.getURIFromCache = function(campaign, uri, source) {
  return undefined;
}

Infringements.prototype.pack = function(entity) {
  PACK_LIST.forEach(function(key) {
    if (entity[key])
      entity[key] = JSON.stringify(entity[key]);
  });

  return entity;
}

//
// Public Methods
//
/**
 * Add a URI for the campaign.
 *
 * @param  {stringOrObject}    campaign    The campaign the URI belongs to.
 * @param  {string}            uri         The uri to add.
 * @param  {string}            type        The type of uri.
 * @param  {string}            source      The source of this infringement.
 * @param  {object}            metadata    Any metadata belonging to this infringement.
 * @param  {function(err,uid)} callback    A callback to receive the uid of the uri, or an error.
 * @return {undefined}
 */
Infringements.prototype.add = function(campaign, uri, type, source, metadata, callback) {
  var self = this
    , campaign = Object.isString(campaign) ? campaign : campaign.RowKey
    , raw = uri
    ;

  callback = callback ? callback : defaultCallback;
  uri = self.normalizeURI(uri);

  var id = self.getURIFromCache(campaign, uri, source);
  if (id) {
    callback(null, id);
    return;
  }

  var entity = {};
  entity.Partitionkey = campaign;
  entity.RowKey = uri;
  entity.raw = raw;
  entity.type = type;
  entity.source = source;
  entity.state = states.infringements.state.UNVERIFIED;
  entity.created = Date.utc.create().getTime();
  entity.verified = -1;
  entity.metadata = metadata;

  entity = self.pack(entity);

  // FIXME: What do we do for existing links & how do we keep cache uptodate?
  self.tableService_.insertEntity(TABLE, campaign, callback);
}