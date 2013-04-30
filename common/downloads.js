/*
 * downloads.js: verification actions
 *
 * Wraps the verification actions.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , crypto = require('crypto')
  , database = acquire('database')
  , exec = require('child_process').exec
  , fs = require('fs')
  , logger = acquire('logger').forFile('downloads.js')
  , path = require('path')
  , sugar = require('sugar')
  , states = acquire('states')
  , util = require('util')
  ;

var Seq = require('seq')
  , Storage = acquire('storage')
  ;

var STORAGE_NAME = 'downloads';

/**
 * Wraps the downloads table.
 * 
 * @return {object}
 */
var Downloads = module.exports = function() {
  this.db_ = null;
  this.downloads_ = null;
  this.infringements_ = null;
  
  this.storage_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Downloads.prototype.init = function() {
  var self = this;

  self.storage_ = new Storage(STORAGE_NAME);

  Seq()
    .seq(function() {
      database.connectAndEnsureCollection('infringements', this);
    })
    .seq(function(db, infringements) {
      self.db_ = db;
      self.infringements_ = infringements;
      database.connectAndEnsureCollection('downloads', this);
    })
    .seq(function(db, downloads) {
      self.downloads_ = downloads;
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
 * Get a unique name depending on the strings passed in.
 * Use to generate a name for a download file depending on it's url [filename] etc.
 * Produces a hash.
 *
 * Ex: generateName(infringement.uri, nameOfFile)
 *
 * @param  {object}     infringement  The infringement the download belongs to.
 * @param  {strings}    [components]  More components to generate a unique name.
 * @return {string}     name
 */
Downloads.prototype.generateName = function(infringement) {
  var string = '';

  Object.values(arguments, function(arg) {
    if (arg == infringement) {
      string += infringement._id;
    } else if (arg) {
      string += arg;
    }
  });

  var shasum = crypto.createHash('sha1');
  shasum.update(string);
  return shasum.digest('hex');
}

/**
 * Adds a file that is already in blob storage to the downloads table
 *
 * @param  {object}          infringement     The infringement that the file belongs to.
 * @param  {string}          name             The name of the file in that container.
 * @param  {string}          mimetype         The mimetype of the file.
 * @param  {number}          size             The size of the file in bytes.
 * @param  {number}          started          When the download started.
 * @param  {number}          finished         When the download finished.
 * @param  {function(err)}   callback         A callback to be called on success, or if there is an error.
 * @return {undefined}
 */
Downloads.prototype.add = function(infringement, name, mimetype, size, started, finished, callback) {
  var self = this
    , docQuery = {
        _id: name
      }
    , doc = {
      _id: name,
      campaign: infringement.campaign,
      infringement: infringement._id,
      name: name,
      mimetype: mimetype,
      size: size,
      created: Date.now(),
      started: started,
      finished: finished
    }
  , infringementQuery = {
      _id: infringement._id
    }
  , infringementUpdates = {
      $addToSet: {
        mimetypes: mimetype
      },
      $inc: {
        downloads: 1
      }
    }
  ;

  if (!self.downloads_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  Seq()
    .seq(function() {
      logger.info('Recording download %s', name);
      self.downloads_.update(docQuery, doc, { upsert: true }, this);
    })
    .seq(function() {
      logger.info('Recording download %s against %s', name, infringement._id);
      self.infringements_.update(infringementQuery, infringementUpdates, this);
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
 * This is the guts of the operation, it basically:
 * 1. Get's the mimetype of the downloaded file
 * 2. Get stats about the file
 * 3. Upload the file to blob storage
 * 4. Register the file in downloads (done via self.add)
 * 5. Register the mimetype of the file against the infringement (done via self.add)
 *
 * @param  {object}          infringement            The infringement that the file belongs to.
 * @param  {string}          filepath                Path to the file to add.
 * @param  {number}          started                 When the download was started.
 * @param  {number}          finished                When the download finished.
 * @param  {function(err)}   callback                Get's called when the process is complete, or there is an error.
 * @return {undefined}
 */
Downloads.prototype.addLocalFile = function(infringement, filepath, started, finished, callback) {
  var self = this
    , mimetype = null
    , filename = path.basename(filepath)
    , size = 0
    ;

  if (!self.downloads_)
    return self.cachedCalls_.push([self.addLocalFile, Object.values(arguments)]);

  Seq()
    .seq(function() {
      self.getFileMimeType(filepath, this);
    })
    .seq(function(mimetype_) {
      mimetype = mimetype_;
      fs.stat(filepath, this);
    })
    .seq(function(stats_) {
      size = stats_.size;
      logger.info('Uploading %s to blob storage', filename);
      self.storage_.createFromFile(filename, filepath, {}, this);
    })
    .seq(function() {
      logger.info('Uploaded %s (%s, %s). Adding to the downloads table', filename, mimetype, size);
      self.add(infringement, filename, mimetype, size, started, finished, this);
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
 * Find the mimetype of the file as best as possible using different tools.
 *
 * @param  {string}                    filepath    The file to test.
 * @param  {function(err,mimetype)}    callback    A callback to receive the mimetype, or an error.
 * @return {undefined}
 */
Downloads.prototype.getFileMimeType = function(filepath, callback) {
  var self = this
    , mimetype = ''
    ;

  Seq()
    .seq(function() {
      exec('file --mime-type ' + filepath, this);
    })
    .seq(function(stdout) {
      mimetype = stdout.split(' ')[1];
      exec('xdg-mime query filetype ' + filepath, this);
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
 * Get all downloads associated with an infringement.
 *
 * @param {object}                    infringement    The infringmeent to get downloads for.
 * @param {object}                    [options]       An optional options object.
 * @param {function(err,downloads)}   callback        A callback to receive the downloads or an error.
 * @return {undefined}
 */
Downloads.prototype.getInfringementDownloads = function(infringement, options, callback) {
  var self = this;

  if (!self.downloads_)
    return self.cachedCalls_.push([self.getInfringementDownloads, Object.values(arguments)]);

  callback = callback ? callback : options;
  callback = callback ? callback : defaultCallback;
  
  self.downloads_.find({ infringement: infringement._id }).toArray(callback);
}   