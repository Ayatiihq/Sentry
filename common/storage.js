/*
 * storage.js: the storage api
 *
 * Wraps blob storage.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , fs = require('fs')
  , knox = require('knox')
  , logger = acquire('logger').forFile('storage.js')
  , path = require('path')
  , sugar = require('sugar')
  , util = require('util')
  , utilities = acquire('utilities')
  ;

var MultipartUpload = require('knox-mpu')
  , Seq = require('seq');

var MAX_SINGLE_UPLOAD_SIZE = 99 * 1024 * 1024; // As per my tests

/**
 * Wraps the blob storage.
 *
 * @param  {string}     container     The name of the container this storage object represents.
 * @return {object}
 */
var Storage = module.exports = function(container) {
  this.client_ = null;
  this.container_ = container;

  this.defaultHeaders_ = {};

  this.init();
}

Storage.prototype.init = function() {
  var self = this;

  self.client_ = knox.createClient({
      key: config.AWS_KEY
    , secret: config.AWS_SECRET
    , bucket: config.AWS_BUCKET
  });

  self.defaultHeaders_ = { 'x-amz-acl': 'public-read' };
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
 * @param  {string}            campaignID         The campaign's id. 
 * @param  {string}            name               The content's name.
 * @param  {string}            text               The text of the content.
 * @param  {object}            options            The options object.
 * @param  {boolean}           [options.replace]  Replace an existing file with the same name.
 * @param  {function(err)}     callback           A callback to receive an err, if one occurs.
 * @return {undefined}
 */
Storage.prototype.createFromText = function(campaignID, name, text, options, callback) {
  var self = this
    , headers = self.defaultHeaders_
    , objPath = util.format('/%s/%s/%s', self.container_, campaignID, name)
    ;

  callback = callback ? callback : defaultCallback;

  headers['Content-Length'] = text.length;
  headers['Content-Type'] = options['Content-Type'] || 'text/plain';
  
  var req = self.client_.put(objPath, headers);
  req.on('response', function(res) {
    if (res.statusCode == 200)
      return callback();

    callback(new Error('Text upload failed with status code %d', res.statusCode));
  });
  req.on('error', function(err) {
    callback(new Error('Text upload failed: %s', err));
  });
  req.end(text);
}


/*
 * Create a new file in storage, optionally overwrite if one by the same name already
 * exists.
 * @param  {string}            campaignID         The campaign's id.
 * @param  {string}            md5                File md5.
 * @param  {string}            filepath           The filepath of the local file to upload.
 * @param  {object}            options            The options object.
 * @param  {boolean}           [options.replace]  Replace an existing file with the same name.
 * @param  {function(err)}     callback           A callback to receive an err, if one occurs.
 * @return {undefined}
 */
Storage.prototype.createFromFile = function(campaignID, md5, filepath, options, callback) {
  var self = this
    , headers = self.defaultHeaders_
    , objPath = util.format('/%s/%s/%s', self.container_, campaignID, md5)
    ;

  callback = callback ? callback : defaultCallback;

  Seq()
    .seq(function() {
      utilities.getFileMimeType(filepath, this);
    })
    .seq(function(mimetype) {
      headers['Content-Type'] = mimetype;

      fs.stat(filepath, this);
    })
    .seq(function(stat) {
      headers['Content-Length'] = stat.size;
      
      if (stat.size > MAX_SINGLE_UPLOAD_SIZE) {       
        var upload = new MultipartUpload({
            client: self.client_,
            objectName: objPath,
            file: filepath,
            batchSize: 5
          },
          this);
        upload.on('uploaded', function(info) { logger.info('Uploaded part %d of %s', info.part, filepath); });

      } else {
        self.client_.putFile(filepath, objPath, headers, this);
      }
    })
    .seq(function() {
      callback();
    })
    .catch(function(err) {
      callback(err);
    })
    ;
}

/*
 * Create a new file in storage from a URL, optionally overwrite an existing one.
 *
 * @param  {string}           campaignID           The campaign's id.
 * @param  {string}           name                 The content's name.
 * @param  {string}           url                  The URL to download.
 * @param  {object}           options              The options object.
 * @param  {boolean}          [options.replace]    Replace an existing file with the same name.
 * @param  {boolean}          [options.maxLength]  The maximium length the content downloaded can be.
 * @param  {function(err)}    callback             A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Storage.prototype.createFromURL = function(campaignID, name, url, options, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  utilities.request(url, options, function(err, res, body) {
    if (err)
      return callback(err);

    options['Content-Type'] = res.headers['content-type'];

    self.createFromText(campaignID, name, body, options, callback);
  });
}

/*
 * Get a file from storage as text
 *
 * @param  {string}                campaignID           The campaign's id. 
 * @param  {string}                name                 The content's name.
 * @param  {object}                options              The options object.
 * @param  {function(err,text)}    callback             A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Storage.prototype.getToText = function(campaignID, name, options, callback) {
  var self = this
    , objPath = util.format('/%s/%s/%s', self.container_, campaignID, name)
    ;
  
  callback = callback ? callback : defaultCallback;

  self.client_.getFile(objPath, function(err, res) {
    var data = '';

    if (err)
      return callback(err);

    if (res.statusCode != 200)
      return callback(new Error('Cannot get file %s: Unknown status code %d', objPath, res.statusCode));

    res.setEncoding('utf-8');
    res.on('data', function(chunk) {
      data += chunk
    });
    res.on('end', function() {
      callback(null, data);
    });
  });
}


/*
 * Gets a download url for a name
 *
 * @param  {string}        campaignID           The campaign's id. 
 * @param  {string}        MD5                 The content's MD5.
 * @return {string}        A url to download the content.
 */
Storage.prototype.getURL = function(campaignID, MD5) {
  var self = this
    , template = 'https://s3.amazonaws.com/qarth/%s/%s/%s'
    ;
  return util.format(template, self.container_, campaignID, MD5);
}

/**
 * This'll upload a directory to S3. It does
 * not keep directory structure, rather it flattens out the files into the db.
 *
 * @param  {string}                    campaignID              The campaign's id.
 * @param  {string}                    dir                     Path to the directory to add.
 * @param  {function(err,nUploaded)}   callback                Get's called when the process is complete, or there is an error.
 * @return {undefined}
 */
 Storage.prototype.addLocalDirectory = function(campaignID, dir, callback) {
  var self = this;

  utilities.readAllFiles(dir, function(err, files) {
    var nUploaded = 0;

    if (err)
      return callback(err);

    Seq(files)
      .seqEach(function(file) {
        var that = this;
        self.addLocalFile(campaignID, file, function(err) {
          if (err && files.length == 1) {
            return that(err);
          } else if (err) {
            logger.warn('Unable to upload %s but continuing: %s', file, err);
          } else {
            nUploaded++;
          }
          that();
        });
      })
      .seq(function() {
        callback(null, nUploaded);
      })
      .catch(function(err) {
        callback(err);
      })
      ;
  });
}

/**
 * This is the guts of the uploading a 'download' operation, it basically:
 * 1. Upload the file to blob storage if the file does not exist
 * Note that it will also check to see if the file is already on S3.
 *
 * @param  {string}          campaignID              The campaign's id.
 * @param  {string}          filepath                Path to the file to add.
 * @param  {function(err)}   callback                Get's called when the process is complete, or there is an error.
 * @return {undefined}
 */
Storage.prototype.addLocalFile = function(campaignID, filepath, callback) {
  var self = this
    , md5 = null
    ;

  callback = callback ? callback : defaultCallback;

  Seq()
    .seq(function() {
      utilities.generateMd5(filepath, this);
    })
    .seq(function(md5_){
      md5 = md5_;
      self.doWeHaveThis(campaignID, md5, this);
    })
    .seq(function(alreadyExists){
      if(alreadyExists){
        logger.trace('md5 : ' + md5 + ' already exists for campaign ' + infringement.campaign);
        callback();
      }
      else{
        logger.info('Uploading %s to blob storage as MD5 - %s', filepath, campaignID + '/' + md5);
        self.createFromFile(campaignID, md5, filepath, {}, this);
      }
    })
    .seq(function() {
      callback();
    })
    .catch(function(err) {
      callback(err);
    })
    ;
}

/**
 * @param  {string}                  campaignID      The campaign's id.
 * @param  {string}                  filepath        Path to the file to add.
 * @param  {function(err, result)}   callback        Get's called once we know whether it's there or not
 * @return {undefined}
 */
Storage.prototype.doWeHaveThis = function(campaignID, md5, callback) {
  var self = this
  , headers = self.defaultHeaders_
  , objPath = util.format('/%s/%s/%s', self.container_, campaignID, md5)
  ;

  callback = callback ? callback : defaultCallback;

  Seq()
    .seq(function(){
      self.client_.getFile(objPath, this);
    })
    .seq(function(resp){
      if(resp.statusCode === 200)
        return callback(null, true);
      callback(null, false);
    })
    .catch(function(err){
      callback(err);
    })
    ;
}
