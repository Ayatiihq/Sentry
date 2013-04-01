/*
 * util.js: utilities
 *
 * Some useful utilities for the system.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , crypto = require('crypto')
  , exec = require('child_process').exec
  , https = require('https')
  , logger = acquire('logger').forFile('utilities.js')
  , os = require('os')
  , querystring = require('querystring')
  , sugar = require('sugar')
  , URI = require('URIjs')
  , util = require('util')
  , request = require('request')
  ;

var Seq = require('seq');

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
 * Returns the scheme of the URI
 *
 * @param  {string}   uri      The uri to retrieve the schema of.
 * @return {string}            The scheme.
 */
Utilities.getURIScheme = function(uri) {
  var scheme = uri;

  try {
    scheme = URI(uri).scheme();
  } catch (err) {
    scheme = uri.split(':')[0];
  }
  return scheme;
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
    if (arg)
      string += '.' + arg;
  });

  var shasum = crypto.createHash('sha1');
  shasum.update(string);
  return shasum.digest('hex');
}

/**
 * Gets the version information for this checkout.
 *
 * @return {object} version   The version object for this checkout.
 */
Utilities.getVersion = function(callback) {
  var data = {};
  callback = callback ? callback : function() {};

  Seq()
    .seq('cached', function() {
      if (Utilities.__version__)
        callback(Utilities.__version__);
      else
        this();
    })
    .par('log', function() {
      var that = this;
      exec('git log -n1', function(err, stdout, stderr) {
        data.log = stdout;
        that();
      });
    })
    .par('rev', function() {
      var that = this;
      exec('git rev-parse HEAD', function(err, stdout, stderr) {
        data.revision = stdout.compact();
        that();
      });
    })
    .par('shortrev', function() {
      var that = this;
      exec('git rev-parse --short HEAD', function(err, stdout, stderr) {
        data.shortRevision = stdout.compact();
        that();
      });
    })
    .seq('done', function() {
      Utilities.__version__ = data;
      callback(data);
    });
}

Utilities.notify = function(message) {
  var msg = {};

  if (config.NO_NOTIFY)
    return;

  msg.method = 'post';
  msg.path = '/v1/rooms/message';
  msg.data = {
    room_id: 'Chapek 9',
    from: 'Sentry',
    message: message,
    notify: 0,
    color: 'green',
    message_format: 'html'
  };

  msg.host = 'api.hipchat.com';
  if (msg.query == null) {
    msg.query = {};
  }
  msg.query['auth_token'] = 'a3ab7f9f02809eaca99ecbbfad37cd';
  msg.query = querystring.stringify(msg.query);
  msg.path += '?' + msg.query;
  if (msg.method === 'post' && (msg.data != null)) {
    msg.data = querystring.stringify(msg.data);
    if (msg.headers == null) {
      msg.headers = {};
    }
    msg.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    msg.headers['Content-Length'] = msg.data.length;
  }

  var req = https.request(msg);
  req.write(msg.data);
  req.end();
}

/**
 * Follows redirects manually 
 * @param  {array}  links   A array usually containing one link from which to start the requesting from   
 * @param  {object} promise A promise instance which resolves at some point returning an array of link(s)
 * @return {object} the given promise.
 */

Utilities.followRedirects = function(links, promise) {

  function onHeadResponse(results, thePromise, err, resp, html){
    if(err){
      logger.info('error onHeadResponse ! : ' + err.message);
      thePromise.resolve(results);
      return;      
    }

    var circularCheck = results.some(resp.headers.location); 

    if(circularCheck){
      logger.info('clocked a circular reference - finish up');
      thePromise.resolve(results);
    }
    else if(resp.headers.location){
      var redirect = URI(resp.headers.location.replace(/\s/g, ""));
      if(redirect.is("relative"))
        redirect = redirect.absoluteTo(links.last());
      // push this link into our results  
      results.push(redirect.toString());
      logger.info('request redirect location : ' + redirect.toString());
      requestHeader(results, thePromise);
    }
    else{
      thePromise.resolve(results);      
    }
  }
  // Request just the headers with a long timeout
  // Don't allow redirects to follow on automatically
  request.head(links.last(),
              {timeout: 30000, followRedirect: false},
              onHeadResponse.bind(null, links, promise));
  return promise;
}

/**
 * Produces a string id for the machine and worker.
 *
 * @return {object} the id of the worker.
 */
Utilities.getWorkerId  = function() {
  return util.format('%s-%s', os.hostname(), process.pid);
}