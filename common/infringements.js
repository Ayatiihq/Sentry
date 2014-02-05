/*
 * infringements.js: the infringements table
 *
 * Wraps the infringements table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , database = acquire('database')
  , logger = acquire('logger').forFile('infringements.js')
  , sugar = require('sugar')
  , states = require('./states')
  , util = require('util')
  , utilities = require('./utilities')
  ;

var COLLECTION = 'infringements'
  , EDUPLICATE = 11000
  ;

/**
 * Wraps the infringements table.
 * 
 * @return {object}
 */
var Infringements = module.exports = function() {
  this.infringements_ = null;

  this.cachedCalls_ = [];

  this.init();
}

Infringements.prototype.init = function() {
  var self = this;

  database.connectAndEnsureCollection(COLLECTION, function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.db_ = db;
    self.infringements_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

function defaultCallback(err) {
  if (err && err.code !== 'EntityAlreadyExists')
    logger.warn('Reply Error: %s', err.message);
}

function ifUndefined(test, falsey) {
  return test ? test : falsey;
}

function normalizeCampaign(campaign) {
  if (Object.isString(campaign)) {
    // It's the _id of the campaign
    return campaign;
  } else if (campaign._id) {
    // It's an entire campaign row
    return campaign._id;
  }
}

function normalizeClient(client) {
 if (client._id) {
    // It's an entire client row
    return client._id;
  } else {
    // It's just the _id object
    return client;
  }
}

//
// Public Methods
//

/**
 * Generates a unique key for the campaign, uri and optional metadata.
 *
 * @param {stringOrObject}     campaign    The campaign the uri infringement belongs to.
 * @param {string}             uri         The uri to add.
 * @param {string}             [metadata]  Optional metadata for uri.
 * @return {string}                        The unique key.
 */
Infringements.prototype.generateKey = function(campaign, uri, metadata) {
  campaign = normalizeCampaign(campaign);
  return utilities.genLinkKey(JSON.stringify(campaign), uri, metadata);
}

/**
 * Add a infringement for the campaign.
 *
 * @param  {stringOrObject}    campaign    The campaign the URI belongs to.
 * @param  {string}            uri         The uri to add.
 * @param  {string}            type        The type of uri.
 * @param  {string}            source      The source of this infringement.
 * @param  {object}            pointsEntry The points (rating) of this infringment (to signify how 'hot' this infringment is)
 * @param  {object}            metadata    Any metadata belonging to this infringement.
 * @param  {function(err,uid)} callback    A callback to receive the uid of the uri, or an error.
 * @return {undefined}
 */
Infringements.prototype.add = function(campaign, uri, type, source, state, pointsEntry, metadata, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.add, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  callback = callback ? callback : defaultCallback;
  uri = utilities.normalizeURI(uri);
  pointsEntry.created = Date.now();

  var entity = {};
  entity._id = self.generateKey(campaign, uri);
  entity.campaign = campaign;
  entity.uri = uri;
  entity.scheme = utilities.getURIScheme(uri);
  entity.type = type;
  entity.source = source;
  entity.downloads = [];
  entity.state = states.infringements.state.NEEDS_PROCESSING;
  entity.created = Date.now();
  entity.points = {
    total: pointsEntry.score ? pointsEntry.score : 0,
    modified: Date.now(),
    entries: [ pointsEntry ]
  };
  entity.metadata = metadata ? metadata : {};
  entity.parents = { count: 0, uris: [] };
  entity.children = { count: 0, uris: [] };

  self.infringements_.insert(entity, function(err) {
    if (!err || err.code === EDUPLICATE)
      callback(null, entity._id);
    else
      callback(err);
  });
}

/**
 * Add a meta infringement (an infringement that doesn't have a unique URI of it's own). A
 * relationship between the meta infringement and the original uri is automatically added.
 *
 * @param {stringOrObject}    campaign    The campaign the infringement belongs to.
 * @param {string}            uri         The uri that contains the infringement.
 * @param {string}            source      The source of the meta infringement (google, bing, etc).
 * @param {object}            metadata    Metadata about the infringement.
 * @param {function(err,uid)} callback    Callback to receive the uid of the infringement, or an error.
 * @return {undefined}
 */
Infringements.prototype.addMeta = function(campaign, uri, type, source, state, metadata, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addMeta, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  uri = utilities.normalizeURI(uri);
  callback = callback ? callback : defaultCallback;

  var entity = {};
  entity._id = self.generateKey(campaign, uri, source);
  entity.campaign = campaign;
  entity.uri = uri;
  entity.scheme = utilities.getURIScheme(uri);
  entity.type = type;
  entity.meta = true;
  entity.source = source;
  entity.state = states.infringements.state.NEEDS_PROCESSING;
  entity.created = Date.now();
  entity.points = {
    total: 0,
    modified: Date.now(),
    entries: []
  };
  entity.metadata = metadata;
  entity.parents = { count: 0, uris: [] };
  entity.children = { count: 0, uris: [] };

  self.infringements_.insert(entity, function(err) {
    if (!err || err.code === EDUPLICATE) {
      self.addMetaRelation(campaign, uri, source);
      callback(null, entity._id);
    }
    else
      callback(err);
  });
}

/**
 * Adds a parent -> child relationship between uris.
 *
 * @param {stringOrObject}    campaign    The campaign the uris belong to.
 * @param {string}            parent      The parent URI.
 * @param {string}            child       The child URI.
 * @param {function(err)}     callback    A callback to handle errors.
 * @return {undefined}   
 */
Infringements.prototype.addRelation = function(campaign, parent, child, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addRelation, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  parent = utilities.normalizeURI(parent);
  child = utilities.normalizeURI(child);
  callback = callback ? callback : defaultCallback;

  if (parent === child)
    return callback();

  // Set the forward link, only find documents that don't have the child already in
  var query = {
        _id: self.generateKey(campaign, parent),
        'children.uris': {
          $nin: [ child ]
        }
      }
    , updates = {
        $inc: { 'children.count': 1 },
        $set: { 'children.modified': Date.now() },
        $addToSet: { 'children.uris': child }
      }
    ;
  
  self.infringements_.update(query, updates, defaultCallback);

  // Set the reverse link
  query = {
    _id: self.generateKey(campaign, child),
    'parents.uris': {
       $nin: [ parent ]
    }
  };
  updates = {
    $inc: { 'parents.count': 1 },
    $set: { 'parents.modified': Date.now() },
    $addToSet: { 'parents.uris': parent }
  };
  
  self.infringements_.update(query, updates, callback);
}

/**
 * Adds a parent -> child relationship between uris where source is a meta link.
 *
 * @param {stringOrObject}    campaign    The campaign the uris belong to.
 * @param {string}            uri         The uri.
 * @param {string}            source      The source of the meta infringement (google, bing, etc).
 * @param {function(err)}     callback    A callback to handle errors.
 * @return {undefined}   
 */
Infringements.prototype.addMetaRelation = function(campaign, uri, owner, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addMetaRelation, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);
  uri = utilities.normalizeURI(uri);
  callback = callback ? callback : defaultCallback;

  // Set the forward link
  var query = {
        _id: self.generateKey(campaign, uri, owner),
        'children.uris': {
          $nin: [ uri ]
        }
      }
    , updates = {
        $inc: { 'children.count': 1 },
        $set: { 'children.modified': Date.now() },
        $addToSet: { 'children.uris': uri }
      }
    ;
  
  self.infringements_.update(query, updates, defaultCallback);

  // Set the reverse link
  var parent = 'meta+' + owner + ':' + self.generateKey(campaign, uri, owner);
  query = {
    _id: self.generateKey(campaign, uri),
    'parents.uris': {
      $nin: [ parent ]
    }
  };
  updates = {
    $inc: { 'parents.count': 1 },
    $set: { 'parents.modified': Date.now() },
    $addToSet: { 'parents.uris': parent }
  };
  
  self.infringements_.update(query, updates, callback);
}

/**
 * Adds points to the target infringement.
 *
 * @param {object}            infringement    The infringement the points belong to.
 * @param {string}            source          The source of the points -> role.plugin
 * @param {integer}           score           The new values to be added to the points {} on the infringements.
 * @param {string}            message         Info about the context.
**/
Infringements.prototype.addPoints = function(infringement, source, score, message, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addPoints, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $inc: {
      'points.total': score
    },
    $set: {
      'points.modified': Date.now()
    },
    $push: {
      'points.entries': {
        score: score,
        source: source,
        message: message,
        created: Date.now()
      }
    },
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}

/**
 * Adds download to the target infringement.
 *
 * @param {object}            infringement    The infringement the points belong to.
 * @param {string}            fileMd5         The MD5 of the download
 * @param {string}            fileMimetype    Mimetype of the file
 * @param {number}            fileSize        size of the file, no idea what units, assuming bytes
**/
Infringements.prototype.addDownload = function(infringement, fileMd5, fileMimetype, fileSize, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addDownload, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $push: {
      'downloads': {
        md5: fileMd5,
        mimetype: fileMimetype,
        processedBy: [],
        size: fileSize,
        created: Date.now()
      }
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);

}

/**
 * Adds points to the target infringement and sets that infringement as processed by the processer.
 *
 * @param {object}            infringement    The infringement the points belong to.
 * @param {string}            source          The source of the points -> role.plugin
 * @param {integer}           score           The new values to be added to the points {} on the infringements.
 * @param {string}            message         Info about the context.
 * @param {integer}           processor       The processor of the infringement.
 * @param {function(err)}     callback        A callback to receive an error, if one occurs.
 * @return {undefined}
**/
Infringements.prototype.addPointsBy = function(infringement, source, score, message, processor, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.addPoints, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $inc: {
      'points.total': score
    },
    $set: {
      'points.modified': Date.now()
    },
    $push: {
      'points.entries': {
        score: score,
        source: source,
        message: message,
        created: Date.now()
      },
      'metadata.processedBy': processor
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}


/**
 * Change the state field on the given infringement with the given state
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          state            The state to be to set on the infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.setState = function(infringement, state, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.setState, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.infringements_.update({ _id: infringement._id }, { $set: { state: state } }, callback);
}

/**
 * Verify the given infringement
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          state            The state to be to set on the infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.verify = function(infringement, state, processor, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.setState, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.infringements_.update({ _id: infringement._id },
                             { $set: { state: state, verified : Date.now() },
                               $push: {'metadata.processedBy': processor} },
                               callback);
}
/**
 * Change the state field on the given infringement with the given state and mark the
 * the infringement as processed by who.
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          state            The state to be to set on the infringement.
 * @param {integer}          processor        The processor of the infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.setStateBy = function(infringement, state, processor, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.setState, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $set: {
      state: state
    },
    $push: {
      'metadata.processedBy': processor
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}

/**
 * Gets the list of unverified infringements for a given campaign
 *
 * @param {object}           campaign         The campaign which we want unverified links for
 * @param {number}           limit            Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err)}    callback         A callback to handle errors.
*/
Infringements.prototype.getNeedsScraping = function(campaign, limit, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getNeedsScraping, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.NEEDS_SCRAPE
  };

  self.infringements_.find(query).limit(limit ? limit : 1000).toArray(callback); 
}

/**
 * Gets one infringement that needs scraping
 *
 * @param {object}           campaign         The campaign which we want unverified links for
 * @param {function(err)}    callback         A callback to handle errors.
*/
Infringements.prototype.getOneNeedsScraping = function(campaign, callback)
{
  var self = this
    , then = Date.create('15 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getOneNeedsScraping, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.NEEDS_SCRAPE,
    popped: {
      $lt: then
    }
  };

  var sort = [['created', 1 ]];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  var options = { new : true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);
}

/**
 * Gets the number of links that need scraping
 *
 * @param  {object}                campaign      The campaign for which to search links.
 * @param  {function(err,count)}   callback      A callback to receive the count, or an error.
 * @return {undefined}
 */
Infringements.prototype.getNeedsScrapingCount = function(campaign, callback) {
  var self = this;
  
  if (!self.infringements_)
    return self.cachedCalls_.push([self.getNeedsScrapingCount, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign,
    state: states.infringements.state.NEEDS_SCRAPE
  };

  self.infringements_.find(query).count(callback); 
}

/**
 * Get infringements which have this download
 *
 * @param  {object}                download      The query
 * @param  {function(err,count)}   callback      A callback to receive the count, or an error.
 * @return {undefined}
 */
Infringements.prototype.getForDownload = function(download, callback) {
  var self = this;
  
  if (!self.infringements_)
    return self.cachedCalls_.push([self.getForDownload, Object.values(arguments)]);
  var iStates = states.infringements.state;
  
  var query = {
    'downloads.md5' : download.md5,
    'state' : {$nin : [iStates.FALSE_POSITIVE,
                       iStates.UNAVAILABLE,
                       iStates.VERIFIED,
                       iStates.SENT_NOTICE,
                       iStates.TAKEN_DOWN]},    
  };

  self.infringements_.find(query).toArray(callback); 
}
/**
 * Get infringements for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {object}                options          The options for the request
 * @param {number}                options.skip     The number of documents to skip, for pagenation.
 * @param {number}                options.limit    Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Infringements.prototype.getForCampaign = function(campaign, options, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign
  };

  var opts = { 
    skip: options.skip, 
    limit: options.limit,
    sort: { created: -1 }
  };

  if (Object.isArray(options.state)) {
    query.state = { $in: options.state };
  } else if (options.state > -2) {
    query.state = options.state;
  }

  if (options.category > -1) {
    query.category = options.category;
  }

  if (options.mimetypes) {
   query['downloads.mimetype'] = { $in: options.mimetypes };
  }

  if (options.after) {
    query.created = { $gt: options.after };
  }

  if (options.search && options.search.length > 3) {
    query.uri = new RegExp('(' + options.search.replace(/\ /gi, '|') + ')', 'i');
  }

  if (options.project)
    self.infringements_.find(query, options.project, opts).toArray(callback);
  else
    self.infringements_.find(query, opts).toArray(callback);
}

/**
 * Get infringements for a campaign at the specified points.
 *
 * @param {object}                client           The client which we want unverified links for
 * @param {object}                options          The options for the request
 * @param {number}                options.skip     The number of documents to skip, for pagenation.
 * @param {number}                options.limit    Limit the number of results. Anything less than 1 is limited to 1000.
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Infringements.prototype.getForClient = function(client, options, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getForClient, Object.values(arguments)]);

  client = normalizeClient(client);

  var query = {
    client: client
  };

  var opts = { 
    skip: options.skip, 
    limit: options.limit,
    sort: { created: -1 }
  };

  if (Object.isArray(options.state)) {
    query.state = { $in: options.state };
  } else if (options.state > -2) {
    query.state = options.state;
  }

  if (options.category > -1) {
    query.category = options.category;
  }

  if (options.mimetypes) {
   query['downloads.mimetype'] = { $in: options.mimetypes };
  }

  self.infringements_.find(query, opts).toArray(callback); 
}

/**
 * Get infringements count for a campaign at the specified points.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {object}                options          The options which we want unverified links for
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Infringements.prototype.getCountForCampaign = function(campaign, options, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getCountForCampaign, Object.values(arguments)]);

  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign
  };

  if (Object.isArray(options.state)) {
    query.state = { $in: options.state };
  } else if (options.state > -2) {
    query.state = options.state;
  }
  
  if (options.category > -1) {
    query.category = options.category;
  }

  if (options.mimetypes) {
   query['downloads.mimetype'] = { $in: options.mimetypes };
  }

  if (options.after) {
    query.created = { $gt: options.after };
  }

  if (options.search && options.search.length > 3) {
    query.uri = new RegExp('(' + options.search.replace(/\ /gi, '|') + ')', 'i');
  }

  self.infringements_.find(query).count(callback);
}

/**
 * Get infringements count for a campaign at the specified points.
 *
 * @param {object}                client         The client which we want unverified links for
 * @param {object}                options        The options which we want unverified links for
 * @param {function(err,list)}    callback       A callback to receive the infringements count, or an error;
*/
Infringements.prototype.getCountForClient = function(client, options, callback)
{
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getCountForClient, Object.values(arguments)]);

  client = normalizeClient(client);

  var query = {
    client: client
  };

  if (Object.isArray(options.state)) {
    query.state = { $in: options.state };
  } else if (options.state > -2) {
    query.state = options.state;
  }

  if (options.category > -1) {
    query.category = options.category;
  }

 if (options.mimetypes) {
    query['downloads.mimetype'] = { $in: options.mimetypes };
 }

  self.infringements_.find(query).count(callback);
}

/**
 * Get infringements for the purger.
 *
 * @param {object}                campaign         The campaign which we want unverified links for
 * @param {function(err,list)}    callback         A callback to receive the infringements, or an error;
*/
Infringements.prototype.getPurgable = function(campaign, callback)
{
  var self = this;
  if (!self.infringements_)
    return self.cachedCalls_.push([self.getPurgable, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;
  var iStates = states.infringements.state;
  
  var query = {'campaign' : campaign._id,
               'state' : {$in : [iStates.FALSE_POSITIVE,
                                 iStates.UNAVAILABLE,
                                 iStates.VERIFIED,
                                 iStates.SENT_NOTICE,
                                 iStates.TAKEN_DOWN]},
               'metadata.processedBy' : {$nin : ['purger']},
               'verified': {$lt: Date.create('7 days ago').getTime()} 
              };

  self.infringements_.find(query).toArray(callback);
}

/**
 * Purge that infringement
 * @param {object}                infringement      The infringement which we want to work on
 * @param {function(err,list)}    callback          A callback to receive the infringements, or an error
*/
Infringements.prototype.purge = function(infringement, callback)
{
  var self = this
    , iStates = states.infringements.state;
  ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.purge, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;
  
  var irrelevant = infringement.state === iStates.UNAVAILABLE ||
                   infringement.state === iStates.FALSE_POSITIVE;

  if(irrelevant){
    targets = {'type' : 1,
               'source' : 1, 
               'scheme' : 1, 
               'processed' : 1, 
               'popped' : 1, 
               'entries' : 1, 
               'modified' : 1, 
               'points' : 1,
               'downloads' : 1};
  }
  else{
    targets = {'points' : 1,
               'entries' : 1,
               'scheme' : 1};
  }

  var query = {
    $unset : targets
  };

  self.infringements_.update({_id: infringement._id}, query, callback);
}


/**
 * Mark this infringement's download processedBy with the processor
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {md5}              md5              The md5 of the target download
 * @param {integer}          processor        Who has processed this infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.downloadProcessedBy = function(infringement, md5, processor, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.downloadProcessedBy, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var query = {
    $and: [{'downloads.md5' : md5},
           { _id: infringement._id }]
  };

  var updates = {
    $push: {
      'downloads.$.processedBy': processor
    }
  };

  self.infringements_.update(query, updates, callback);
}

/**
 * Mark this infringement as processedBy the processor
 *
 * @param {object}           infringement     The infringement which we want to work on
 * @param {integer}          processor        Who has processed this infringement.
 * @param {function(err)}    callback         A callback to handle errors. 
**/
Infringements.prototype.processedBy = function(infringement, processor, callback){
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.processedBy, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  var updates = {
    $push: {
      'metadata.processedBy': processor
    }
  };

  self.infringements_.update({ _id: infringement._id }, updates, callback);
}

/**
 * Get all infringements that have a needs-download state for the campaign and category.
 *
 * @param {object}                        campaign    The campaign to search.
 * @param {number}                        category    The category of infringement to find.
 * @param {function(err,infringments)}    callback      A callback to receive the infringmeents, or an err
 * @return {undefined}
 */
Infringements.prototype.getNeedsDownloadForCampaign = function(campaign, category, callback) {
  var self = this
    , query = {
        meta: {
          $exists: false
        },
        campaign: campaign._id,
        category: category,
        state: states.infringements.state.NEEDS_DOWNLOAD
      }
    , project = {
        _id: 1,
        state: 1,
        metadata: 1,
        type: 1,
        uri: 1
      }
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getNeedsDownloadForCampaign, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;

  self.infringements_.find(query, project).toArray(callback);
} 

/**
 * Update the popped timestamp for the infringement to the current time.
 *
 * @infringement {object}   The infringement to touch.
 * @callback {function(err)}  A callback to receive the error, if one occurs
 * @return  {null}
 */
Infringements.prototype.touch = function(infringement, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.touch, Object.values(arguments)]);

  self.infringements_.update({ _id: infringement._id },
                             { $set: { popped: Date.now() } },
                             defaultCallback);
}

/**
 * Update the metadata on the infringement with the new key value pair.
 * @infringement {object}   The infringement to update
 * @key {string} key which to add to the metaData property
 * @value {object} value for the new key
 * @callback {function(err, infringements)} function to be called when the operation has completed
 * @return  {null}
 */
Infringements.prototype.setMetadata = function(infringement, key, value, callback) {
  var self = this;
  tempMetadata = infringement.metadata ? infringement.metadata : {};
  tempMetadata[key] = value;
 
  callback = callback ? callback : defaultCallback;

  self.infringements_.update({ _id: infringement._id },
                             { $set: { metadata: tempMetadata} },
                             callback);
}

Infringements.prototype.getOneInfringement = function(infringementID, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getOneInfringement, Object.values(arguments)]);
  
  callback = callback ? callback : defaultCallback;  

  self.infringements_.findOne({_id: infringementID}, callback);
}

/**
 * Get all infringements that have downloads of a certain mimetype(s)
 *
 * @param {object}                    campaign                 A Campaign
 * @param {object}                    options                  An options object
 * @param {array}                     options.mimetypes        Mimetypes to filter on
 * @param {string}                    options.notProcessedBy   Name of a processor to ignore
 * @param {function(err,downloads)}   callback        A callback to receive the downloads or an error.
 * @return {undefined}
 */
Infringements.prototype.popForCampaignByMimetypes = function(campaign, options, callback) {
  var self = this
    , then = Date.create('15 minutes ago').getTime()
    ;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.popForCampaignByMimetypes, Object.values(arguments)]);

  callback = callback ? callback : defaultCallback;
  options = options || {};
  campaign = normalizeCampaign(campaign);

  var query = {
    campaign: campaign._id,
    $or: [
      { popped: { $lt: then } },
      { popped: { $exists: false } }
    ]
  };

  if (options.mimetypes)
    query['downloads.mimetype'] = { $in: options.mimetypes };

  if (options.notProcessedBy)
    query['downloads.processedBy'] = { $ne: options.notProcessedBy };

  var sort = [[ 'created', 1 ]];

  var updates = {
    $set: {
      popped: Date.now()
    }
  };

  options = { new: true };

  self.infringements_.findAndModify(query, sort, updates, options, callback);

}

/**
 * Get all the campaign torrent infringements that are unverifed and don't have torrent file schemes.
 *
 * @param {object}                    campaign                 A Campaign
 * @param {function(err, torrents)}   callback                 A callback to receive the torrent unverfieds or an error.
 * @return {undefined}
 */
Infringements.prototype.getTorrentPagesUnverified = function(campaign, callback) {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.getTorrentPagesUnverified, Object.values(arguments)]);

  var query = {
    campaign: campaign._id,
    $and: [
      { category: states.infringements.category.TORRENT },
      { scheme : /^(?![torrent|magnet])/},
      { "children.count" : 0}
    ]
  };
  self.infringements_.find(query).toArray(callback); 
}
