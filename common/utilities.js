/*
 * util.js: utilities
 *
 * Some useful utilities for the system.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var crypto = require('crypto')
  , sugar = require('sugar')
  , URI = require('URIjs')
  , util = require('util')
  ;

var Utilities = module.exports;

Utilities.normalizeURI = function(uri) {
  var self = this
    , original = uri
    ;

  try {
    uri = URI(uri)

    // Make it sane (http://medialize.github.com/URI.js/docs.html#normalize)
    uri.normalize();

    // Remove www
    if (uri.subdomain() === 'www')
      uri.subdomain('');

    // Alphabetize the querystring
    var querystring = uri.query();
    if (querystring && querystring.length > 0) {
      // First remove the existing string
      uri.search('');

      // Get the queries into something we can sort
      var map = URI.parseQuery(querystring);
      var list = [];
      Object.keys(map, function(key) {
        list.push({ key: key, value : map[key]});
      });

      // Sort the queries alphabetically
      list = list.sortBy(function(n) {
        // Even sort the values if it's an array
        var val = n.value;
        if (Object.isArray(val)) {
          n.value = val.sortBy(function(v) {
            return v;
          });
        }
        return n.key;
      });

      // Now add back the params, but this time alphabetically
      list.forEach(function(n) {
        var query = {};
        query[n.key] = n.value;
        uri.addSearch(query);
      });
    }

    uri = uri.toString();

  } catch (err) {
    logger.warn('Malformed URI %s', orignal);
    uri = orignal;
  }

  return uri;
}

/**
 * Generates a key that can be used in azure for URIs. Will normalize the URI too.
 *
 * @param {string}    uri     The uri to generate a key for.
 * @param {string}    [meta]  Optional meta tag if the key is for a meta URI.
 * @return {string}           The key.
 */
Utilities.genURIKey = function(uri, meta) {
  uri = Utilities.normalizeURI(uri);

  if (meta)
    uri = 'meta.' + meta + '.' + uri;

  var shasum = crypto.createHash('sha1');
  shasum.update(uri);
  return shasum.digest('hex');
}


/**
 * Generates a key that can be used in azure for links.
 *
 * @param {args}    arguments     The arguments to generate the key for.
 * @return {string} key           The key.
 */
Utilities.genLinkKey = function() {
  var string = '';

  Object.values(arguments, function(arg) {
    string += '.' + arg;
  });

  var shasum = crypto.createHash('sha1');
  shasum.update(string);
  return shasum.digest('hex');
}