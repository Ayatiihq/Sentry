/// <reference path="C:\tools\nodejs-intellisense\nodelib\node.js"/>
/*
 * youtube.js: a youtube scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * requires the following metadata:
 *    campaign.metadata.suspiciousVideoDuration       => integer, seconds
      campaign.metadata.optionalVideoKeywords         => [strings]
      campaign.metadata.requiredVideoKeywords         => [strings]
      campaign.metadata.videoDate                     => ISO date time string, JSON.stringify() will convert Date objects to the correct format.
      campaign.metadata.youtubeConfidenceThreshold    => float, 0.0 -> 1.0, everything below this value will not be added.
 *
 */
require('sugar');
var acquire = require('acquire')
  , ConfidenceAggregator = acquire('confidence-aggregator')
  , events = require('events')
  , logger = acquire('logger').forFile('youtube.js')
  , util = require('util')
  , request = require('request')
  , url = require('url')
  , Promise = require('node-promise')
  , querystring = require('querystring')
  , XRegExp = require('XRegExp').XRegExp
;

var Scraper = acquire('scraper');
var API_KEY = 'AIzaSyCnkZOQzHxqC8iLwnGfTFi_seFLLNBrcyQ';

var YoutubeAggregator = function () {
  var self = this;
  self.init();
};

util.inherits(YoutubeAggregator, ConfidenceAggregator.ConfidenceAggregator);

/* Aggregator overridables */
YoutubeAggregator.prototype.getCategory = function (ytVideo) { return ytVideo.snippet.categoryId; };
YoutubeAggregator.prototype.getDescription = function (ytVideo) { return ytVideo.snippet.description; };
YoutubeAggregator.prototype.getDuration = function (ytVideo) {
  // youtube likes to be special and use an ISO format for duration rather than just seconds because seconds would be too simple.
  var res = XRegExp.exec(ytVideo.contentDetails.duration, XRegExp('PT(?:(?<hours>[0-9]+)H)?(?:(?<minutes>[0-9]+)M)?(?:(?<seconds>[0-9]+)S)?')); //ignore jslint
  if (res === null) { throw new Error('did not match against: ' + ytVideo.contentDetails.duration); }
  var time = 0;
  if (!!(res.hours)) { time += parseInt(res.hours, 10) * 3600; }
  if (!!(res.minutes)) { time += parseInt(res.minutes, 10) * 60; }
  if (!!(res.seconds)) { time += parseInt(res.seconds, 10); }
  return time;
};
YoutubeAggregator.prototype.getThumbnails = function (ytVideo) {
  return Object.values(ytVideo.snippet.thumbnails).map(function trasformYtThumbs(v) { return v.url; });
};
YoutubeAggregator.prototype.getTitle = function (ytVideo) { return ytVideo.snippet.title; };
YoutubeAggregator.prototype.getPublishTime = function (ytVideo) { return new Date(ytVideo.snippet.publishedAt); };

/* - Scraper module - */
var Youtube = module.exports = function () {
  this.init();
};

util.inherits(Youtube, Scraper);

Youtube.prototype.init = function () {
  var self = this;
  this.aggregator = new YoutubeAggregator();
};

//
// Overrides
//
Youtube.prototype.getName = function () {
  return "youtube";
};

Youtube.prototype.start = function (campaign, job) {
  var self = this;
  var success = false;
  if (!!(campaign.metadata)) {
    try {
      self.aggregator.installAnalyzer(ConfidenceAggregator.analyzerLargeDurations(campaign.metadata.suspiciousVideoDuration), 1); // 20 minutes
      self.aggregator.installAnalyzer(ConfidenceAggregator.analyzerKeywords(campaign.metadata.optionalVideoKeywords, campaign.metadata.requiredVideoKeywords), 1);
      self.aggregator.installAnalyzer(ConfidenceAggregator.analyzerFindDate(new Date(campaign.metadata.videoDate)), 1);
      self.confidenceThreshold = campaign.metadata.youtubeConfidenceThreshold;
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
    logger.info('started for %s', campaign.name);
    self.emit('started');
    var fullTextSearch = campaign.metadata.optionalVideoKeywords.union(campaign.metadata.requiredVideoKeywords).join(' ');
    var args = { publishedAfter: campaign.metadata.videoDate };
    self.beginSearch(fullTextSearch, args).then(self.stop.bind(self));
  }
};

Youtube.prototype.stop = function () {
  var self = this;
  
  // go through all our collected links, emit a link for each of them.
  self.aggregator.getData().each(function (datum) {
    if (datum.weightedConfidence >= self.confidenceThreshold) {
      var metadata = datum.metadata;
      metadata.confidence = datum.weightedConfidence;
      var uri = 'http://www.youtube.com/watch?v=' + datum.metadata.id;

      // we actually emit two links, the youtube site page and a special youtube:// uri,
      // the second one will be useful when we find youtube id's embedded in web pages and want to relate to the youtube video
      // not the youtube page.
      self.emit('infringement', uri, metadata);
      self.emit('infringement', 'youtube://' + datum.metadata.id, metadata); // youtube:// id, not an actual protocol.
      self.emit('relation', uri, 'youtube://' + datum.metadata.id);
    }
  });

  self.emit('finished');
};

Youtube.prototype.isAlive = function (cb) {
  cb();
};

/* -- Youtube API Code -- */
Youtube.prototype.getAPI = function (api, query) {
  var self = this;
  var promise = new Promise.Promise();

  var urlObj = url.parse('https://www.googleapis.com/youtube/v3/' + api);
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

/* Resolves to the raw JSON result from googleapi/v3/ */

Youtube.prototype.getVideoInfo = function (videoID, args) {
  var self = this;
  var promise = new Promise.Promise();
  var query = {
    part: 'id,snippet,contentDetails,player,statistics,status,topicDetails',
    id: videoID,
    key: API_KEY
  };
  Object.merge(query, args, true, false);

  self.getAPI('videos', query).then(function onVideosFinished(apiResult) {
    promise.resolve(apiResult);
  }, function onVideosError(error) {
    promise.reject(error);
  });

  return promise;
};

Youtube.prototype.handleVideoResults = function (videoResults) {
  var self = this;
  var promise = new Promise.Promise();
  
  videoResults.items.each(self.aggregator.addDatum.bind(self.aggregator));
  promise.resolve();
  return promise;
};

Youtube.prototype.beginSearch = function (searchTerm, args) {
  var self = this;
  var promise = new Promise.Promise();
  var query = {
    part: 'id',
    q: searchTerm,
    maxResults: 50,
    type: 'video',
    key: API_KEY
  }; 
  Object.merge(query, args, true, false);

  self.getAPI('search', query).then(function onSearchResults(searchResults) {
    if (!!(searchResults.nextPageToken)) {
      var handlePromise = self.handleSearchResults(searchResults);

      // call next page
      args.pageToken = searchResults.nextPageToken;

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
Youtube.prototype.handleSearchResults = function (searchResults) {
  var self = this;
  var promise = new Promise.Promise();

  if (Object.has(searchResults, 'items')) {
    var combinedIds = '';
    searchResults.items.each(function combineIds(item) {
      combinedIds += item.id.videoId + ',';
    });
    combinedIds = combinedIds.slice(0, combinedIds.length - 1);

    self.getVideoInfo.call(self, combinedIds)
      .then(self.handleVideoResults.bind(self))
      .then(function onVideoResultsHandled() {
        promise.resolve(searchResults.nextPageToken);
      });
  }
  else {
    promise.reject(new Error('no items in results'));
  }

  return promise;
};

var test = new Youtube();
test.beginSearch('India vs England Test Match December 2012', { publishedAfter: Date.past('december 7th 2012').toISOString() }).then(function onFinished() {
  console.log('finished!');
  console.log(test.aggregator.dataList.length + ' items!');
  var average = test.aggregator.dataList.average(function (v) { return v.confidence; });
  console.log('average confidence: ' + average);
  var maxconf = test.aggregator.dataList.max(function (v) { return v.confidence; }).confidence;
  console.log('maximum confidence: ' + maxconf);
  console.log('total items at max confidence: ' + test.aggregator.dataList.count(function (v) { return (v.confidence >= maxconf); }));


  console.log(test.aggregator.dataList.count(function (v) { return (v.confidence >= average); }) + ' items above average confidence');
  test.aggregator.weightDataSet();
  var fs = require('fs');
  var stream = fs.createWriteStream("/temp/yt-output.csv");
  stream.once('open', function (fd) {
    test.aggregator.dataList.each(function (d) { stream.write(d.weightedConfidence.toString() + ',' + d.confidence.toString() + '\n'); });
    stream.end();
  });

  
});