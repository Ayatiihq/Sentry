/*
 * campaigns.js: the campaigns table
 *
 * Wraps the campaigns table.
 *
 * (C) 2012 Ayatii Limited
 *
 */

var acquire = require('acquire')
  , azure = require('azure')
  , config = acquire('config')
  , logger = acquire('logger').forFile('campaigns.js')
  , sugar = require('sugar')
  , util = require('util')
  ;

var Swarm = acquire('swarm');

var TABLE = 'campaigns'
  , PACK_LIST = ['names', 'metadata', 'scrapersEnabled', 'scrapersIgnored']
  ;

/**
 * Wraps the campaigns table.
 * 
 * @return {object}
 */
var Campaigns = module.exports = function() {
  this.tableService_ = null;

  this.init();
}

Campaigns.prototype.init = function() {
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

Campaigns.prototype.genCampaignKey = function(client, campaign) {
  return util.format('%s.%s', client, campaign);
}

//
// Public Methods
//
/**
 * Get a list of campaigns.
 *
 * @param {function(err, roles)} callback The callback to consume the campaigns.
 * @return {undefined}
 */
Campaigns.prototype.listCampaigns = function(callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select().from(TABLE);
  self.tableService_.queryEntities(query, self.unpack.bind(self, callback));
}

/**
 * Get a list of active campaigns.
 *
 * @param {function(err, roles)} callback The callback to consume the campaigns.
 * @return {undefined}
 */
Campaigns.prototype.listActiveCampaigns = function(callback) {
  var self = this
    , now = Date.utc.create().getTime()
    ;

  callback = callback ? callback : defaultCallback;

  var query = azure.TableQuery.select()
                              .from(TABLE)
                              .where('sweep == ?', true)
                              .and('sweepFrom < ?', now)
                              .and('sweepTo > ?', now);
  self.tableService_.queryEntities(query, self.unpack.bind(self, callback));
}

Campaigns.prototype.unpack = function(callback, err, list) {
  var self = this;

  if (err) {
    callback(err);
    return;
  }

  list.forEach(function(campaign) {
    PACK_LIST.forEach(function(key) {
      if (campaign[key])
        campaign[key] = JSON.parse(campaign[key]);
    });
  });

  callback(err, list);
}

/**
 * Adds a campaign.
 *
 * @param {object}          campaign     An object containing details of the campaign.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Campaigns.prototype.add = function(client, campaign, callback) {
  var self = this
    , now = Date.utc.create().getTime()
    ;
  
  callback = callback ? callback : defaultCallback;

  if (!(client && client.RowKey && client.name)) {
    callback(new Error('client should exist and have a valid RowKey & name'));
    return;
  }

  if (!(campaign && campaign.name && campaign.type)) { 
    callback(new Error('campaign should exist & have name and type'));
    return;
  }

  campaign.PartitionKey = client.RowKey;
  campaign.RowKey = self.genCampaignKey(client.name, campaign.name);

  campaign.name = campaign.name;
  campaign.type = campaign.type;
  campaign.description = ifUndefined(campaign.description, '');
  campaign.avatar = ifUndefined(campaign.avatar, '');
  campaign.created = now;
  campaign.sweep = ifUndefined(campaign.sweep, false);
  campaign.sweepFrom = ifUndefined(campaign.sweepFrom, now);
  campaign.sweepTo = ifUndefined(campaign.sweepTo, Date.utc.create('two weeks from now').getTime());
  campaign.sweepIntervalMinutes = ifUndefined(campaign.sweepIntervalMinutes, 180);
  campaign.names = JSON.stringify(ifUndefined(campaign.names, []));
  campaign.metadata = JSON.stringify(ifUndefined(campaign.metadata, {}));
  campaign.scrapersEnabled = JSON.stringify(ifUndefined(campaign.scrapersEnabled, []));
  campaign.scrapersIgnored = JSON.stringify(ifUndefined(campaign.scrapersIgnored,  []));

  self.tableService_.insertEntity(TABLE, campaign, callback);
}

/**
 * Update a campaign's details.
 *
 * @param {object}          updates    An object containing updates for the campaign.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Campaigns.prototype.update = function(updates, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(updates && updates.PartitionKey && updates.RowKey)) {
    callback(new Error('Updates should have PartitionKey and RowKey'));
    return;
  }

  var data = {};
  Object.keys(updates, function(key, value) {
    if (PACK_LIST.indexOf(key) > -1)
      value = JSON.stringify(value);
    data[key] = value;
  });

  self.tableService_.mergeEntity(TABLE, data, callback);
}

/**
 * Remove a campaign.
 *
 * @param {object}          campaign     An object containing details of the campaign.
 * @param {function(err)}   callback   A callback to receive an error, if one occurs.
 * @return {undefined}
 */
Campaigns.prototype.remove = function(campaign, callback) {
  var self = this;
  callback = callback ? callback : defaultCallback;

  if (!(campaign && campaign.PartitionKey && campaign.RowKey)) {
    callback(new Error('Campaign should have PartitionKey and RowKey'));
    return;
  }
  self.tableService_.deleteEntity(TABLE, campaign, callback);
}