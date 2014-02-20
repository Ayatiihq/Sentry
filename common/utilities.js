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
  , fs = require('fs')
  , http = require('http')
  , https = require('https')
  , logger = acquire('logger').forFile('utilities.js')
  , os = require('os')
  , path = require('path')
  , querystring = require('querystring')
  , sugar = require('sugar')
  , request = require('request')
  , URI = require('URIjs')
  , URL = require('url')
  , util = require('util')
  , zlib = require('zlib')
  , useragents = acquire('useragents')
  ;

var Promise = require('node-promise').Promise
  , Seq = require('seq')
  ;

var REQ_TIMEOUT = 0.5 * 1000 * 60;

/* cache manager is a simple caching system
 * it works like a dict object, you add a thing with a hashkey,
 * but it will only keep the last limit items in memory
 */
var CacheManager = function (limit) {
  this.limit = (limit) ? limit : 50;
  this.store = {};
}

/* looks up key, returns value or null if key does not exist 
 * gets are fast.
 */
CacheManager.prototype.get = function (key) { 
  var self = this;
  var datum = self.store[key];
  if (datum) {
    // update timestamp on key
    datum.timestamp = new Date().getTime();
    return datum.value;
  }
  return null;
}

 /* sets a key with value, is much slower than get as we have to trim the store
  * 
  */
CacheManager.prototype.set = function (key, value) {
  var self = this;
  self.store[key] = { 'value': value, 'timestamp': new Date().getTime() };
  if (self.store.length > self.limit) {
    var oldestKey = Object.keys(self.store).sortBy(function (key) { self.store[key].timestamp }).first();
    delete self.store[oldestKey];
  }
}

var Utilities = module.exports;

Utilities.joinURIS = function (sourceURI, targetURI, baseURI) {
  var absoluteURI = (baseURI) ? baseURI : sourceURI;
  try {
    composedURI = URI(targetURI).absoluteTo(absoluteURI).toString();
  } catch (error) {
    return null; // probably 'javascript;'
  }
  return composedURI;
}

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
 * Generates an MD5 string from the file found at the given filepath. 
 * Ex: generateMd5(filePath)
 *
 * @param  {string}     filePath  location of file for input
 * @return {string}     Md5 of the file.
 */
Utilities.generateMd5 = function(filePath, callback) {
  var md5sum = crypto.createHash('md5');
  var s = fs.ReadStream(filePath);

  s.on('data', function(d) {
    md5sum.update(d);
  });

  s.on('end', function() {
    var d = md5sum.digest('hex');
    logger.trace('Md5 : ' + d + '  ' + filePath);
    callback(null, d);
  });  

  s.on('err', function(err){
    callback(err);
  }); 
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
 * Generates a SHA1 hash of the input, useful for creating unique IDs.
 *
 * @param  {args}    arguments     The arguments to generate the key for.
 * @return {string}  key           The key.
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
      logger.warn('followRedirects : ' + err.message);
      promise.resolve(results);
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
      //logger.info('clocked a circular reference - finish up');
      thePromise.resolve(results);
    }
    else{
      // push this link into our results  
      results.push(redirect.toString());
      //logger.info('request redirect location : ' + redirect.toString());
      // go again.
      Utilities.followRedirects(results, thePromise);
    }
  }
  // Make sure to populate the referrer and the user-agent in the headers
  var requestHeaders = {'Referer' : links.length < 2 ? '' : links[links.length - 2],
                        'User-Agent': useragents.random()};

  // Request just the headers with a long timeout
  // Don't allow redirects to follow on automatically
  request.head(links.last(),
              {timeout: 30000, followRedirect: false,
               headers: requestHeaders},
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
    , called = false
    ;

  // use CacheManager to speed up generic a ton
  if (Utilities.requestURLCache === undefined) {
    Utilities.requestURLCache = new CacheManager();
  }

  try {
    parsed = URL.parse(url);
  } catch (err) {
    return callback(err);
  }

  if (Utilities.requestURLCache.get(url)) {
    callback.apply(null, Utilities.requestURLCache.get(url));
    return;
  }

  var requestOptions = {
    host: parsed.host,
    path: parsed.path,
    port: parsed.port,
    headers: {
      'accept-encoding': 'gzip,deflate',
      'User-Agent': useragents.random()
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

  req.on('response', function (response) {
    var body = (options.returnBuffer) ? [] : ''
    , stream = null
    , done = called ? function() {} : callback
    ;

    called = true;

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

    stream.on('data', function (chunk) {
      if (options.returnBuffer) {
        body.push(chunk);
      }
      else {
        body += chunk;
      }
      
      if (options.maxLength) {
        if (body.length > options.maxLength) {
          err = new Error('Body too large (greater than maxLength: ' + options.maxLength + ')');
          req.abort();
        }
      }
    });

    stream.on('end', function () {
      if (options.returnBuffer) {
        body = Buffer.concat(body);
      }
      clearTimeout(timeoutId);
      Utilities.requestURLCache.set(url, [err, response, body]);
      done(err, response, body);
    });

  });

  req.on('error', function(err) {
    clearTimeout(timeoutId);
    var done = called ? console.log.bind('Error', url) : callback;
    called = true;
    Utilities.requestURLCache.set(url, [err]);
    done(err);    
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
    logger.warn('Unable to get hostname for %s', uri);
    return '';
  }
}

Utilities.getDomain = function(uri) {
  try {
    uri = URI(uri);
    return uri.domain();

  } catch (err) {
    logger.warn('Unable to get domain for %s', uri);
    return '';
  }
}

Utilities.getPath = function(uri) {
  try {
    uri = URI(uri);
    return uri.path();

  } catch (err) {
    logger.warn('Unable to get path for %s', uri);
    return '';
  }
}

/**
 * Requests to a stream for piping elsewhere
 *
 * @param {string}                       url                      The URL to get.
 * @param {object}                       options                  Options for the request.
 * @param {boolean}                      options.followRedirects  Whether to follow redirects (default: true).
 * @param {funtion(err,req,res,stream)}  callback                 Callback to receive the request, response and stream. Or an error.          
 */
Utilities.requestStream = function(url, options, callback) {
  callback = callback ? callback : options;
  options = callback ? options : {};

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
 * @param  {string}                             url                       The URL to get.
 * @param  {object}                             options                   Options for the request. Sent to http[s].request as well.
 * @param  {function(err,req,response,stream)}  callback                  The callback to receive the stream of the URL, or an error.
 * @return {undefined}
 */
Utilities.requestURLStream = function(url, options, callback) {
  var parsed = null
    , err = null
    , called = false
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
      'accept-encoding': 'gzip,deflate',
      'User-Agent': useragents.random()
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
      , done = called ? function() {} : callback
      ;

    called = true;

    if (response.statusCode >= 400) {
      var err = new Error ('Server returned error status code: ' + response.statusCode);
      err.statusCode = response.statusCode;
      return done(err, null, response);
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

    done(err, req, response, stream);
  });

  req.on('error', function(err) {
    var done = called ? console.log.bind('Error', url) : callback;
    called = true;
    done(err);
  });
}

/**
 * Recursively reads all files in a directory.
 *
 * @param {string}                  dir       Directory to read
 * @param {function(err,files)}     callback  Callback to receive the files, or an error.
 * @return {undefined}
 */
Utilities.readAllFiles = function(dir, done) {
  var self = this
    , results = []
    ;

  fs.readdir(dir, function(err, list) {
    if (err)
      return done(err);

    var i = 0;
    (function next() {
      var file = list[i++];
      
      if (!file)
       return done(null, results);

     if (file.startsWith('.'))
      return next();

      file = path.join(dir, file);
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          self.readAllFiles(file, function(err, res) {
            results = results.concat(res);
            next();
          });
        } else if (file) {
          results.push(file);
          next();
        } else {
          next();
        }
      });
    })();
  });
}

/**
 * Check if the uri has a path, or if it's just a domain name
 *
 * @uri {string}  uri   The uri to test
 * @return {boolean}  Whether the URI has a path
 */
Utilities.uriHasPath = function(uri) {
  var ret = true;
  try {
    var parsed = url.parse(uri);
    ret = parsed.path != '/';
  } catch (err) {
    ;
  }
  return ret;
}

/**
 * Find the mimetype of the file as best as possible using different tools.
 *
 * @param  {string}                    filepath    The file to test.
 * @param  {function(err,mimetype)}    callback    A callback to receive the mimetype, or an error.
 * @return {undefined}
 */
Utilities.getFileMimeType = function(filepath, callback) {
  var mimetype = '';

  Seq()
    .seq(function() {
      exec('file --mime-type "' + filepath + '"', this);
    })
    .seq(function(stdout) {
      mimetype = stdout.split(' ')[1];
      exec('xdg-mime query filetype "' + filepath + '"', this);
    })
    .seq(function(stdout) {
      mimetype = stdout;
      callback(null, mimetype.compact());
    })
    .catch(function(err) {
      callback(mimetype == '' ? err : null, mimetype.compact());
    })
    ;
}

/**
 * Create a regex from the line that is passed in with options as to how the regex will behave
 *
 * @param  {string}       line               A line to construct a regex from
 * @param  {object}       options
 * @param  {boolean}      options.anyWord    Match on any word in the line (default: false)
 * @return {#RegExp}
 */
Utilities.buildLineRegexString = function(line, options) {
  options = options || {};

  // Sanitize the line, this makes the-line-look-like-this
  line = line.parameterize();

  // Get an array of useful words
  var words = line.split('-').filter(function(word) { return word.length > 1; });

  // Depending on options, construct the right regex
  var regexString = "";
  if (options.anyWord) {
    regexString = '(';
    for (var i = 0; i < words.length; i++) {
      if (i)
        regexString += '|';
      regexString += RegExp.escape(words[i]);
    }
    regexString += ')';

  } else {
    regexString = "^";
    for (var i = 0; i < words.length; i++) {
      regexString += '(?=.*\\b';
      regexString += RegExp.escape(words[i]);
      regexString += !i ? '\\b)' : ')';
    }
    regexString += '.*$';
  }

  return regexString;
}

/**
 * This takes an awkard string (like a url) and simplifies it for regex word matching
 *
 * @param  {string}       string      String to simplify
 * @return {string}                   Simplified string
 */
Utilities.simplifyForRegex = function(string) {
  var ret = string;
  try {
    ret = ret.unescapeURL();
  } catch(err) {
  }
  
  return ret.parameterize().replace(/(\-|\_)/i, ' ');
}

Utilities.tryMakeDir = function(name, done) {
  fs.mkdir(name, 0777, function(err) {
    if (!err) {
      return done();
    } else if (err.code == 'EEXIST') {
      logger.info('Using pre-existing download directory');
      done();
    } else {
      done(err);
    }
  });
}
