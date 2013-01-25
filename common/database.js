/*
 * database.js: list of available database
 *
 * (C) 2012 Ayatii Limited
 *
 * Database compiles a cache of all the available database so they can be easily
 * enumerated and started.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('database.js')
  , pg = require('pg').native
  , states = acquire('states')
  , util = require('util')
  ;

// Wraps the postgres Query object and allows for calls to do unmarshalling
// of replies etc
var Query = function(query, rowUnmarshaller) {
  var self = this;

  self.query_ = query;
  self.rowUnmarshaller_ = rowUnmarshaller;

  self.query_.on('row', function(row) {
    var result = self.rowUnmarshaller_ ? self.rowUnmarshaller_(row) : row;
    self.emit('row', result);
  });

  self.query_.on('error', function(err) {
    self.emit('error', err);
  })

  self.query_.on('end', function() {
    self.emit('end');
  })
}

util.inherits(Query, events.EventEmitter);

var Database = function() {
  this.ready_ = false;
  this.client_ = null;

  this.init();
}

util.inherits(Database, events.EventEmitter);

Database.prototype.init = function() {
  var self = this;

  pg.connect(config.DATABASE_URL, self.onDatabaseConnection.bind(self));
}

Database.prototype.getClient = function(callback) {
  var self = this;

  pg.connect(config.DATABASE_URL, callback);
}

Database.prototype.onDatabaseConnection = function(error, client) {
  var self = this;

  if (error) {
    logger.warn('Unable to connect to the database', error);
    return;
  }

  self.client_ = client;

  self.ready_ = true;
  self.emit('ready');
}

//
// Public
//

Database.prototype.isReady = function() {
  return this.ready_;
}

Database.prototype.getActiveCampaigns = function() {
  var self = this;
  
  var qActiveCampaigns = "SELECT id, name, sweepintervalminutes, type, scrapersenabled, scrapersignored \
                          FROM campaigns \
                          WHERE \
                            sweepenabled AND \
                            sweepfromdate < current_timestamp AND \
                            sweeptodate > current_timestamp \
                          ;";
  var query = self.client_.query(qActiveCampaigns);

  return new Query(query);
}

Database.prototype.getActiveJobs = function(campaignId) {
  var self = this;
  var qActiveJobs = "SELECT DISTINCT ON (scraper) id, scraper, created, started, finished, state \
                     FROM scraperjobs \
                     WHERE \
                       campaign = $1 \
                     ORDER BY scraper, created DESC \
                     ;";
  var query = self.client_.query(qActiveJobs, [campaignId]);
  return new Query(query);
}

Database.prototype.insertJob = function(campaignId, scraper, properties) {
  var self = this;
  var qInsertJob = "INSERT INTO scraperjobs \
                    (campaign, scraper, properties) \
                    VALUES ($1, $2, '%s') \
                    ;";

  var statement = util.format(qInsertJob, objToPropertyString(properties));
  var query = self.client_.query(statement, [campaignId, scraper]);
  return new Query(query);
}

Database.prototype.startJob = function(id, properties) {
  var self = this;
  properties = properties ? properties : {};

  var rawQStartJob = "UPDATE scraperjobs \
                       SET \
                         state = $1, \
                         started = current_timestamp, \
                         properties = properties || '%s' \
                       WHERE \
                         properties->'msgId' = '%s' \
                       ;";

  var statement = util.format(rawQStartJob, objToPropertyString(properties), id);
  var query = self.client_.query(statement, states.scraper.jobState.STARTED);

  return new Query(query);
}

Database.prototype.pauseJob = function(id, properties) {
  var self = this;
  properties = properties ? properties : {};

  var rawQPauseJob = "UPDATE scraperjobs \
                       SET \
                         state = $1, \
                         properties = properties || '%s' \
                       WHERE \
                         properties->'msgId' = '%s' \
                       ;";

  var statement = util.format(rawQPauseJob, objToPropertyString(properties), id);
  var query = self.client_.query(statement, states.scraper.jobState.PAUSED);

  return new Query(query);
}

Database.prototype.finishJob = function(id, properties) {
  var self = this;
  properties = properties ? properties : {};

  var rawQFinishJob = "UPDATE scraperjobs \
                       SET \
                         state = $1, \
                         finished = current_timestamp, \
                         properties = properties || '%s' \
                       WHERE \
                         properties->'msgId' = '%s' \
                       ;";

  var statement = util.format(rawQFinishJob, objToPropertyString(properties), id);
  var query = self.client_.query(statement, states.scraper.jobState.COMPLETED);

  return new Query(query);
}

Database.prototype.closeJob = function(id, state, err) {
  var self = this;
  err = err ? err : "";

  var rawQDeleteJob = "UPDATE scraperjobs \
                       SET \
                         state = $1, \
                         finished = current_timestamp, \
                         properties = properties || '\"error\"=>\"%s\"' \
                       WHERE \
                         properties->'msgId' = '%s' \
                       ;";

  var statement = util.format(rawQDeleteJob, err, id);
  var query = self.client_.query(statement, [state]);

  return new Query(query);
}

Database.prototype.getJobDetails = function(id, callback) {
  var self = this;

  var rawQJobDetails = "SELECT \
                          scraperjobs.*, \
                          campaigns.name AS campaignname, \
                          campaigns.names AS campaignnames, \
                          campaigns.properties AS campaignproperties \
                        FROM \
                          scraperjobs, campaigns \
                        WHERE \
                          scraperjobs.campaign = campaigns.id \
                        AND \
                          scraperjobs.properties->'msgId' = '%s' \
                        ;";

  var statement = util.format(rawQJobDetails, id);
  var query = self.client_.query(statement);

  function unmarshaller(row) {
    row.properties = mapFromPgProperties(row.properties);

    var id = row.campaign;
    row.campaign = {};
    row.campaign.id = id;
    row.campaign.name = row.campaignname;
    row.campaign.names = arrayFromPgArray(row.campaignnames);
    row.campaign.properties = mapFromPgProperties(row.campaignproperties);
    
    return row;
  }

  return new Query(query, unmarshaller);
}

//
// Utils
//
function arrayFromPgArray(arrStr) {
  if (!arrStr)
    return [];

  var clean = arrStr.substr(1, arrStr.length - 2);
  var tokens = clean.split(',');
  var ret = [];

  tokens.forEach(function(token) {
    ret.push(dequote(token));
  });

  return ret;
}

function mapFromPgProperties(raw) {
  var ret = {};

  if (!raw)
    return ret;

  var props = raw.split(',');
  if (props.length < 1)
    return ret;

  props.forEach(function(prop) {
    var tokens = prop.split('=>');
    ret[dequote(tokens[0])] = dequote(tokens[1]);
  });

  return ret;
}

function dequote(raw) {
  return raw.substring(raw.indexOf('"') + 1, raw.lastIndexOf('"'));
}

function objToPropertyString(obj) {
  var ret = '';
  var template = '"%s" => "%s"';
  var i = 0;

  if (!obj) 
    return ret;

  Object.keys(obj, function(key, value) {
    if (i != 0)
      ret += ', ';
    
    ret += util.format(template, key, escapeString(value));
    i++;
  });

  return ret;
}

function escapeString(str) {
    return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
        switch (char) {
            case "\0":
                return "\\0";
            case "\x08":
                return "\\b";
            case "\x09":
                return "\\t";
            case "\x1a":
                return "\\z";
            case "\n":
                return "\\n";
            case "\r":
                return "\\r";
            case "\"":
            case "'":
            case "\\":
            case "%":
                return "\\\\"+char; // prepends a backslash to backslash, percent,
                                  // and double/single quotes
        }
    });
}

//
// Single database connection per thread
//
module.exports = new Database();