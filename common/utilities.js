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
  , http = require('http')
  , https = require('https')
  , logger = acquire('logger').forFile('utilities.js')
  , os = require('os')
  , querystring = require('querystring')
  , sugar = require('sugar')
  , request = require('request')
  , URI = require('URIjs')
  , URL = require('url')
  , util = require('util')
  , zlib = require('zlib')
  , fs = require('fs')
  ;

var Promise = require('node-promise').Promise
  , Seq = require('seq')
  ;

var REQ_TIMEOUT = 0.5 * 1000 * 60;

var Utilities = module.exports;

Utilities.normalizeURI = function(uri) {
  var self = this
    , original = uri
    ;

  try {
    uri = URI(uri)

    // Protect against gord's amazing regex sk1llz
    if (uri.domain().length < 1)
      uri = URI(Utilities.unescapeURL(original));

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
    logger.info('Malformed URI %s', original);
    uri = Utilities.unescapeURL(original)
  }

  return uri;
}

Utilities.unescapeURL = function(uri) {
  var ret = uri;
  try {
    ret = uri.unescapeURL();
  } catch (err) {
    //logger.warn('Unable to unescape URI %s: %s', uri, err);
  }
  return ret;
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
      logger.warn('error onHeadResponse ! : ' + err.message);
      thePromise.resolve(results);
      return;      
    }

    var redirect = null;
    if(resp.headers.location){
      redirect = URI(resp.headers.location.replace(/\s/g, ""));
      if(redirect.is("relative"))
        redirect = redirect.absoluteTo(results.last());      
    }

    if(!redirect){
      thePromise.resolve(results);      
      return;      
    }
    // Make sure to check infinite looping against the 
    // full uri and not just the headers.location
    var circularCheck = results.some(redirect.toString()); 

    if(circularCheck){
      logger.info('clocked a circular reference - finish up');
      thePromise.resolve(results);
    }
    else{
      // push this link into our results  
      results.push(redirect.toString());
      logger.info('request redirect location : ' + redirect.toString());
      // go again.
      Utilities.followRedirects(results, thePromise);
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
 * Gets the content of a URL
 *
 * @param  {string}                         url                       The URL to get.
 * @param  {object}                         options                   Options for the request. Sent to http[s].request as well.
 * @param  {number}                         options.maxlength         The maximum size of the data in bytes.
 * @param  {boolean}                        options.followRedirects   Whether to follow redirects (default: true)
 * @param  {function(err,response,body)}    callback                  The callback to receive the body of the URL, or an error.
 * @return {undefined}
 */
Utilities.request = function(url, options, callback) {

  if (Object.has(options, 'followRedirects') && !options.followRedirects) {
    Utilities.requestURL(url, options, callback);
  } else {
    var promise = new Promise();

    Utilities.followRedirects([url], promise);
    promise.then(function(links) {
      Utilities.requestURL(links.last(), options, callback);
    },
    callback);
  }
}


/**
 * Gets the content of a URL
 *
 * @param  {string}                         url                       The URL to get.
 * @param  {object}                         options                   Options for the request. Sent to http[s].request as well.
 * @param  {number}                         options.maxSize           The maximum size of the data in bytes.
 * @param  {function(err,response,body)}    callback                  The callback to receive the body of the URL, or an error.
 * @return {undefined}
 */
Utilities.requestURL = function(url, options, callback) {
  var parsed = null
    , err = null
    ;

  try {
    parsed = URL.parse(url);
  } catch (err) {
    return callback(err);
  }

  var requestOptions = {
    host: parsed.host,
    path: parsed.path,
    port: parsed.port,
    headers: {
      'accept-encoding': 'gzip,deflate'
    }
  };

  var req;
  if (url.startsWith('https'))
    req = https.get(requestOptions);
  else
    req = http.get(requestOptions);
  
  req.on('socket', function(socket) {
    socket.setTimeout(REQ_TIMEOUT);
  });

  var timeoutId = setTimeout(function() {
    err = new Error('Request took too long');
    req.abort();
  },
  REQ_TIMEOUT);

  req.on('response', function(response) {
    var body = ''
      , stream = null
      ;

    switch(response.headers['content-encoding']) {
      case 'gzip':
        var decompresser = zlib.createGunzip();
        decompresser.on('error', function (err) { req.abort(); req.emit('error', err); });
        stream = response.pipe(decompresser);
        break;
      case 'deflate':
        var decompresser = zlib.createInflate();
        decompresser.on('error', function (err) { req.abort(); req.emit('error', err); });
        stream = response.pipe(decompresser);
        break;
      default:
        stream = response;
    }

    stream.on('data', function(chunk) {
      body += chunk;
      
      if (options.maxLength) {
        if (body.length > options.maxLength) {
          err = new Error('Body too large (greater than maxLength: ' + options.maxLength + ')');
          req.abort();
        }
      }
    });

    stream.on('end', function() {
      clearTimeout(timeoutId);
      callback(err, response, body);
    });

  });

  req.on('error', function(err) {
    clearTimeout(timeoutId);
    callback(err);
  });
}
/**
 * Produces a string id for the machine and worker.
 * @return {object} the id of the worker.
 */
Utilities.getWorkerId  = function() {
  return util.format('%s-%s', os.hostname(), process.pid);
}

/**
 * Returns a domain for the uri if possible, or an empty stringify
 *
 */
Utilities.getHostname = function(uri) {
  try {
    uri = URI(uri);
    return uri.hostname();

  } catch (err) {
    return '';
  }
}

/**
 * Requests to a stream for piping elsewhere
 *
 * @param {string}      url                      The URL to get.
 * @param {object}      options                  Options for the request.
 * @param {boolean}     options.followRedirects  Whether to follow redirects (default: true).
 * @param {funtion(err,res,stream)}              
 */
Utilities.requestStream = function(url, options, callback) {
  if (Object.has(options, 'followRedirects') && !options.followRedirects) {
    Utilities.requestURLStream(url, options, callback);
  } else {
    var promise = new Promise();

    Utilities.followRedirects([url], promise);
    promise.then(function(links) {
      Utilities.requestURLStream(links.last(), options, callback);
    },
    callback);
  }
}

/**
 * Gets the content of a URL via a stream. Unlike normal request, we error on http error codes.
 *
 * @param  {string}                         url                       The URL to get.
 * @param  {object}                         options                   Options for the request. Sent to http[s].request as well.
 * @param  {function(err,req,response,stream)}  callback                  The callback to receive the stream of the URL, or an error.
 * @return {undefined}
 */
Utilities.requestURLStream = function(url, options, callback) {
  var parsed = null
    , err = null
    ;

  try {
    parsed = URL.parse(url);
  } catch (err) {
    return callback(err);
  }

  var requestOptions = {
    host: parsed.host,
    path: parsed.path,
    port: parsed.port,
    headers: {
      'accept-encoding': 'gzip,deflate'
    }
  };

  var req;
  if (url.startsWith('https'))
    req = https.get(requestOptions);
  else
    req = http.get(requestOptions);

  req.on('response', function(response) {
    var body = ''
      , stream = null
      ;

    if (response.statusCode >= 400) {
      var err = new Error ('Server returned error status code: ' + response.statusCode);
      err.statusCode = response.statusCode;
      return callback(err, response);
    }

    switch(response.headers['content-encoding']) {
      case 'gzip':
        var decompresser = zlib.createGunzip();
        decompresser.on('error', function (err) { req.abort(); req.emit('error', err); });
        stream = response.pipe(decompresser);
        break;
      case 'deflate':
        var decompresser = zlib.createInflate();
        decompresser.on('error', function (err) { req.abort(); req.emit('error', err); });
        stream = response.pipe(decompresser);
        break;
      default:
        stream = response;
    }

    callback(err, req, response, stream);
  });

  req.on('error', function(err) {
    callback(err);
  });
}
