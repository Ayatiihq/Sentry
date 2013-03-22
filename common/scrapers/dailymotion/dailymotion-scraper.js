/// <reference path="C:\tools\nodejs-intellisense\nodelib\node.js"/>
/*
 * dailmotion.js: a dailmotionscraper
 *
 * (C) 2012 Ayatii Limited
 *
 * requires the following metadata:
 *    campaign.metadata.suspiciousVideoDuration           => integer, seconds
      campaign.metadata.optionalVideoKeywords             => [strings]
      campaign.metadata.requiredVideoKeywords             => [strings]
      campaign.metadata.videoDate                         => ISO date time string, JSON.stringify() will convert Date objects to the correct format.
      campaign.metadata.dailyMotionConfidenceThreshold    => float, 0.0 -> 1.0, everything below this value will not be added.
 *
 */
require('sugar');
var acquire = require('acquire')
  , ConfidenceAggregator = acquire('confidence-aggregator')
  , events = require('events')
  , logger = acquire('logger').forFile('dailymotion-scraper.js')
  , util = require('util')
  , request = require('request')
  , url = require('url')
  , Promise = require('node-promise')
  , querystring = require('querystring')
  , XRegExp = require('XRegExp').XRegExp
;

var Scraper = acquire('scraper');

var DailyMotionAggregator = function () {
  var self = this;
  self.init();
};

util.inherits(DailyMotionAggregator, ConfidenceAggregator.ConfidenceAggregator);

/* Aggregator overridables */
DailyMotionAggregator.prototype.getCategory = function (dmVideo) { return dmVideo.channel; };
DailyMotionAggregator.prototype.getDescription = function (dmVideo) { return dmVideo.description; };
DailyMotionAggregator.prototype.getDuration = function (dmVideo) { return dmVideo.duration; };
DailyMotionAggregator.prototype.getThumbnails = function (dmVideo) { return [dmVideo.thumbnail_url]; };
DailyMotionAggregator.prototype.getTitle = function (dmVideo) { return dmVideo.title; };
DailyMotionAggregator.prototype.getPublishTime = function (dmVideo) { return new Date(dmVideo.created_time * 1000); }; //ms from epoch

/* - Scraper module - */
var DailyMotion = module.exports = function () {
  this.init();
};

util.inherits(DailyMotion, Scraper);

DailyMotion.prototype.init = function () {
  var self = this;
  this.aggregator = new DailyMotionAggregator();
};

//
// Overrides
//
DailyMotion.prototype.getName = function () {
  return "youtube";
};

DailyMotion.prototype.start = function (campaign, job) {
  var self = this;
  var success = false;
  if (!!(campaign.metadata)) {
    try {
      self.aggregator.installAnalyzer(ConfidenceAggregator.analyzerLargeDurations(campaign.metadata.suspiciousVideoDuration), 1); 
      self.aggregator.installAnalyzer(ConfidenceAggregator.analyzerKeywords(campaign.metadata.optionalVideoKeywords, campaign.metadata.requiredVideoKeywords), 1);
      self.aggregator.installAnalyzer(ConfidenceAggregator.analyzerFindDate(new Date(campaign.metadata.videoDate)), 1);
      self.confidenceThreshold = campaign.metadata.dailyMotionConfidenceThreshold;
      this.aggregator.installWeighter(ConfidenceAggregator.nullWeighter);
      success = true;
    } 
    catch (error) {
      logger.error('Metadata missing from campaign: ', error);
    }
  }
  else {
    logger.error('No metadata exists in the campaign.');
  }

  if (success) {
    var fullTextSearch = campaign.metadata.requiredVideoKeywords.union(campaign.metadata.optionalVideoKeywords).join(' ');
    logger.info('started for %s (%s)', campaign.name, fullTextSearch);
    self.emit('started');

    var args = { };
    self.beginSearch(fullTextSearch, args).then(self.stop.bind(self));
  }
};

DailyMotion.prototype.stop = function () {
  var self = this;

  self.aggregator.weightDataSet();

  // go through all our collected links, emit a link for each of them.
  var totalInfringements = 0;
  self.aggregator.getData().each(function (datum) {
    var metadata = datum.datum;

    if (datum.weightedConfidence >= self.confidenceThreshold) {
      metadata.confidence = datum.weightedConfidence;
      var uri = metadata.url;

      // we actually emit two links, the youtube site page and a special dailymotion:// uri,
      // the second one will be useful when we find youtube id's embedded in web pages and want to relate to the dailymotion video
      // not the youtube page.
      self.emit('infringement', uri, metadata);
      self.emit('infringement', 'dailymotion://' + metadata.id, metadata); // dailymotion:// id, not an actual protocol.
      self.emit('relation', uri, 'dailymotion://' + metadata.id);
      totalInfringements++;
    }
  });

  logger.info('Scraper found %d links', self.aggregator.getData().length);
  var average = self.aggregator.dataList.average(function (v) { return v.confidence; });
  var maxconf = self.aggregator.dataList.max(function (v) { return v.confidence; }).confidence;
  var totalmax = self.aggregator.dataList.count(function (v) { return (v.confidence >= maxconf); });
  logger.info('Confidence average:   %d', average);
  logger.info('confidence maximum:   %d', maxconf);
  logger.info('total max confidence: %d', totalmax);

  logger.info('total infringements found: %d', totalInfringements);

  self.emit('finished');
};

DailyMotion.prototype.isAlive = function (cb) {
  cb();
};

/* -- Youtube API Code -- */
DailyMotion.prototype.getAPI = function (api, query) {
  var self = this;
  var promise = new Promise.Promise();

  var urlObj = url.parse('https://api.dailymotion.com/' + api);
  urlObj.search = querystring.stringify(query);

  //logger.info('req: ' + url.format(urlObj));
  var callTime = process.hrtime();
  request(url.format(urlObj), function (err, res, body) {
    callTime = process.hrtime(callTime);
    //logger.info('api(%s) lag: %d', api, callTime[0] + (callTime[1] / 1e9));
    if (err) { promise.reject(err); }
    else {
      try {
        var jsresult = JSON.parse(body);
        promise.resolve(jsresult);
      } catch (jsonError) {
        promise.reject(jsonError);
      }
    }
  });

  return promise;
};

DailyMotion.prototype.handleVideoResults = function (videoResults) {
  var self = this;
  var promise = new Promise.Promise();
  if (!!videoResults) {
    videoResults.each(self.aggregator.addDatum.bind(self.aggregator));
  }

  promise.resolve();
  return promise;
};

DailyMotion.prototype.beginSearch = function (searchTerm, args) {
  var self = this;
  var promise = new Promise.Promise();
  var query = {
    sort: 'relevance',
    search: searchTerm,
    limit: 100,
    fields: [ 'channel',
              'country',
              'created_time',
              'description',
              'duration',
              'id',
              'language',
              'owner',
              'published',
              'tags',
              'thumbnail_url',
              'title',
              'url'].join(',')
  }; 
  Object.merge(query, args, true, false);

  self.getAPI('videos', query).then(function onSearchResults(searchResults) {
    if (searchResults.has_more) {
      var handlePromise = self.handleSearchResults(searchResults);

      // call next page
      args.page = searchResults.page + 1;

      var searchPromise = self.beginSearch(searchTerm, args);

      // once both the handle and search promises resolve, then we resolve this one.
      // ensures that the first beginSearch promise is not resolved until we are truely finished.
      Promise.all([handlePromise, searchPromise]).then(promise.resolve.bind(promise));
    }
    else {
      promise.resolve();
    }
    self.totalPages++;
  });

  return promise;
};


/* Resolves to the nextPageToken */
DailyMotion.prototype.handleSearchResults = function (searchResults) {
  var self = this;
  var promise = new Promise.Promise();

  if (Object.has(searchResults, 'list')) {
    // handle all the video results then resolve our promise
    self.handleVideoResults(searchResults.list).then(promise.resolve.bind(promise, searchResults.nextPageToken));
  }
  else {
    promise.reject(new Error('no items in results'));
  }

  return promise;
};
