/*
 * storage.js: the storage api
 *
 * Wraps blob storage.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('storage.js')
  , sugar = require('sugar')
  , utilities = acquire('utilities')
  ;

/**
 * Wraps the blob storage.
 *
 * @param  {string}     container     The name of the container this storage object represents.
 * @return {object}
 */
var Storage = module.exports = function(container) {
  this.blobService_ = null;
  this.container_ = container;

  this.cachedCalls_ = [];

  this.init();
}

Storage.prototype.init = function() {
  var self = this;


  var service = azure.createBlobService(config.AZURE_CORE_ACCOUNT,
                                              config.AZURE_CORE_KEY);
  service.createContainerIfNotExists(self.container_, { publicAccessLevel: 'blob' }, function(err) {
    if (err)
      return logger.warn('Unable to create container %s: %s', self.container_, err);

    self.blobService_ = service;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

function defaultCallback(err) {
  if (err)
    logger.warn('Reply Error: %j', err);
}

//
// Public Methods
//
/*
 * Get's the container name for this storage instance
 *
 * @return {string}   container name.
 */
Storage.prototype.getContainerName = function() {
  return this.container_;
}

/*
 * Create a new file in storage, optionally overwrite if one by the same name already exists.
 *
 * @param  {string}            name               The content's name.
 * @param  {string}            text               The text of the content.
 * @param  {object}            options            The options object.
 * @param  {boolean}           [options.replace]  Replace an existing file with the same name.
 * @param  {function(err)}     callback           A callback to receive an err, if one occurs.
 * @return {undefined}
 */
Storage.prototype.createFromText = function(name, text, options, callback) {
  var self = this;

  if (!self.blobService_)
    return self.cachedCalls_.push([self.createFromText, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.blobService_.createBlockBlobFromText(self.container_, name, text, callback);
}


/*
 * Create a new file in storage, optionally overwrite if one by the same name already
 * exists.
 *
 * @param  {string}            name               The contents name.
 * @param  {string}            filename           The filename of the file.
 * @param  {object}            options            The options object.
 * @param  {boolean}           [options.replace]  Replace an existing file with the same name.
 * @param  {function(err)}     callback           A callback to receive an err, if one occurs.
 * @return {undefined}
 */
Storage.prototype.createFromFile = function(name, filename, options, callback) {
  var self = this;

  if (!self.blobService_)
    return self.cachedCalls_.push([self.createFromFile, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.blobService_.createBlockBlobFromFile(self.container_, name, filename, callback);
}

/*
 * Create a new file in storage from a URL, optionally overwrite an existing one.
 *
 * @param  {string}           name                 The content's name.
 * @param  {string}           url                  The URL to download.
 * @param  {object}           options              The options object.
 * @param  {boolean}          [options.replace]    Replace an existing file with the same name.
 * @param  {boolean}          [options.maxLength]  The maximium length the content downloaded can be.
 * @param  {function(err)}    callback             A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Storage.prototype.createFromURL = function(name, url, options, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.blobService_)
    return self.cachedCalls_.push([self.createFromURL, Object.values(arguments)]);

  utilities.request(url, options, function(err, res, body) {
    if (err)
      return callback(err);

    self.createFromText(name, body, options, callback);
  });
}

/*
 * Create a new file in storage from a URL, optionally overwrite an existing one.
 *
 * @param  {string}           name                 The content's name.
 * @param  {object}           options              The options object.
 * @param  {function(err)}    callback             A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Storage.prototype.getToText = function(name, options, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!self.blobService_)
    return self.cachedCalls_.push([self.getToText, Object.values(arguments)]);

  self.blobService_.getBlobToText(self.container_, name, options, function(err, text) {
    callback(err, text);
  });
}