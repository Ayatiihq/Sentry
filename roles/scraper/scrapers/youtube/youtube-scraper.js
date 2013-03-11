/// <reference path="C:\tools\nodejs-intellisense\nodelib\node.js"/>
/*
 * youtube.js: a youtube scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper that can scrape all types of media and always takes 5mins to complete
 * it's job. It can be paused and, if so, it will resume it's five minute
 * timeout.
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
;

var Scraper = acquire('scraper');
var API_KEY = 'AIzaSyCnkZOQzHxqC8iLwnGfTFi_seFLLNBrcyQ';

var YoutubeAggregator = function (ytVideo) {
  var self = this;
  self.init();
  self.ytVideo = ytVideo;
};

util.inherits(YoutubeAggregator, ConfidenceAggregator);

/* Aggregator overridables */
YoutubeAggregator.prototype.getCategory = function (ytVideo) { return ytVideo.snippet.categoryId; };
YoutubeAggregator.prototype.getDescription = function (ytVideo) { return ytVideo.snippet.description; };
YoutubeAggregator.prototype.getDuration = function (ytVideo) {
  // youtube likes to be special and use an ISO format for duration rather than just seconds because seconds would be too simple.
  var res = /PT(\d+)M(\d+)S/.exec(ytVideo.contentDetails.duration);
  return (parseInt(res[1], 10) * 60) + parseInt(res[2], 10);
};
YoutubeAggregator.prototype.getThumbnails = function (ytVideo) {
  return Object.values(ytVideo.snippet.thumbnails).map(function trasformYtThumbs(v) { return v.url; });
};
YoutubeAggregator.prototype.getTitle = function (ytVideo) { return ytVideo.snippet.title; };
YoutubeAggregator.prototype.publishTime = function (ytVideo) { return ytVideo.snippet.publishedAt; };

/* - Scraper module - */
var Youtube = module.exports = function () {
  this.init();
};

util.inherits(Youtube, Scraper);

Youtube.prototype.init = function () {
  var self = this;
  self.results = [];
  self.totalPages = 0;
};

//
// Overrides
//
Youtube.prototype.getName = function () {
  return "youtube";
};

Youtube.prototype.start = function (campaign, job) {
  var self = this;

  logger.info('started for %s', campaign.name);
  self.emit('started');
};

Youtube.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Youtube.prototype.isAlive = function (cb) {
  var self = this;

  logger.info('Is alive called');

  if (!self.alive) {
    self.alive = 1;
  }
  else {
    self.alive++;
  }

  if (self.alive > 4) {
    cb(new Error('exceeded'));
  }
  else {
    cb();
  }
};

/* Information Parsing */
Youtube.prototype.grepVideoResult = function (videoResult) {
  function findMonth(text) {
    var months = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|febuary|april|june|july|august|september|october|november|december)/;
  }

};

/* -- Youtube API Code -- */
Youtube.prototype.getAPI = function (api, query) {
  var self = this;
  var promise = new Promise.Promise();

  var urlObj = url.parse('https://www.googleapis.com/youtube/v3/' + api);
  urlObj.search = querystring.stringify(query);

  //logger.info('req: ' + url.format(urlObj));

  request(url.format(urlObj), function (err, res, body) {
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
    id: videoID
  };
  Object.merge(query, args, true, false);

  self.getAPI('videos', query).then(function onVideosFinished(apiResult) {


    promise.resolve();
  }, function onVideosError(error) {
    promise.reject(error);
  });
};

Youtube.prototype.handleVideoResults = function (videoResults) {
  var self = this;
  var promise = new Promise.Promise();

  videoResults.each(function forEachVideoResult(videoResult) {
    self.results.push(videoResult);
  });
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

  self.getAPI('search', query).then(self.handleSearchResults.bind(self), function onSearchError(error) {
    promise.reject(error);
  }).then(function onSearchResultsHandled(nextPageToken) {
    if (self.totalPages < 10) {
      // call next page
      args.pageToken = nextPageToken;
      self.beginSearch(searchTerm, args).then(promise.resolve.bind(promise));
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

  if (!Object.has(searchResults, 'prevPageToken')) {
    //first page
    logger.info('total results: %d', searchResults.pageInfo.totalResults);
  }

  if (Object.has(searchResults, 'items')) {
    var videoResultWorkers = searchResults.items.map(function resultWorkersBuilder(item) {
      return self.getVideoInfo.call(self, item.id.videoID);
    });

    Promise.all(videoResultWorkers).then(self.handleVideoResults.bind(self)).then(function () {
      promise.resolve(searchResults.nextPageToken);
    });
  }
  else {
    promise.reject(new Error('no items in results'));
  }

  return promise;
};

var test = new Youtube();
test.beginSearch('India vs England Test Match December 2012', { publishedAfter: Date.past('december 2012').toISOString() }).then(function onFinished() {
  console.log('finished!');
  console.log(test.results.length + ' items!');
});