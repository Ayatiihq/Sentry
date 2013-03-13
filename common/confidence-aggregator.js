/// <reference path="C:\tools\nodejs-intellisense\nodelib\node.js"/>
/*
 * confidence-aggregator.js
 *
 * (C) 2012 Ayatii Limited
 *
 * takes in data and produces a confidence value 
 *
 */
require('sugar');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('confidence-aggregator.js')
  , Promise = require('node-promise')
  , util = require('util')
  , XRegExp = require('XRegExp')
;

// figures out the confidence of data from various sources, overridables need to be overriden to be useful.
var ConfidenceAggregator = module.exports.ConfidenceAggregator = function () {
  var self = this;
  self.init();
};

ConfidenceAggregator.prototype.init = function () {
  var self = this;
  self.dataList = [];
  self.type = "unspecified";
  self.analyzers = [];
  self.weighter = function () { return null; }; // after all the results are anayzed, run this over all elements to weight the results
};

ConfidenceAggregator.prototype.addDatum = function (datum) {
  var self = this;
  var data = { 'datum': datum, 'confidence': 0, 'weightedConfidence': 0 };
  self.analyzeData(data);
  self.dataList.push(data);
};

ConfidenceAggregator.prototype.installAnalyzer = function (analyzer, weight) {
  var self = this;
  self.analyzers.push({ 'analyzer': analyzer, 'weight': weight });
  self.totalWeight = 0;
  self.analyzers.each(function countWeights(analyzer) { self.totalWeight += analyzer.weight; });
};

ConfidenceAggregator.prototype.sanitizeData = function (data) {
  var self = this;
  data.confidence = data.confidence / self.totalWeight;
};

ConfidenceAggregator.prototype.installWeighter = function (weighter) {
  var self = this;
  self.weighter = weighter;
};

ConfidenceAggregator.prototype.analyzeData = function (data) {
  var self = this;
  self.analyzers.each(function analyze(analyzerContainer) {
    var analyzer = analyzerContainer.analyzer;
    var datumContainer = {
      category: self.getCategory(data.datum),
      description: self.getDescription(data.datum),
      duration: self.getDuration(data.datum),
      metadata: self.getMetaData(data.datum),
      thumbnails: self.getThumbnails(data.datum),
      title: self.getTitle(data.datum),
      publishTile: self.getPublishTime(data.datum)
    };
    data.confidence += analyzer(datumContainer);
  });
  self.sanitizeData(data);
};

ConfidenceAggregator.prototype.weightDataSet = function () {
  var self = this;
  self.weighter(self.dataList);
};

/* overridables */
ConfidenceAggregator.prototype.getCategory = function (datum) { return ""; };
ConfidenceAggregator.prototype.getDescription = function (datum) { return ""; };
ConfidenceAggregator.prototype.getDuration = function (datum) { return 0; };
ConfidenceAggregator.prototype.getMetaData = function (datum) { return datum; };
ConfidenceAggregator.prototype.getThumbnails = function (datum) { return []; };
ConfidenceAggregator.prototype.getTitle = function (datum) { return ""; };
ConfidenceAggregator.prototype.getPublishTime = function (datum) { return Date.now(); };

/* PreBuilt Analyzers */
exports.debugAnalyzer = function (datumContainer) {
  return (Math.random() > 0.5);
};
exports.debugAnalyzer.max = 1;

function findsInTexts(texts, finds) {
  // texts and finds are both arrays, texts should be strings, finds can be strings or arrays, looks for finds in texts
  return texts.some(function (text) {
    return finds.some(function (find) {
      XRegExp(find).test(text);  //ignore jslint
    });
  });
}

exports.analyzerFindDate = function (searchDate) {
  function realAnalyzerFindDate(searchDate, datum) {
    //!!FIXME!! we do this the dumb long way because of https://github.com/andrewplummer/Sugar/issues/281
    // once that issue is fixed, we should get other locals for free too. 
    var day, month, year = '';
    /*ignore jslint start*/ //jslint complains about tab indentation with switch
    switch (searchDate.getWeekday()) {
      case 0:day = XRegExp('(sun|sunday)', 'x'); break;
      case 2:day = XRegExp('(mon|monday)', 'x'); break;
      case 3:day = XRegExp('(tue|tuesday)', 'x'); break;
      case 4:day = XRegExp('(wed|wednesday)', 'x'); break;
      case 5:day = XRegExp('(thur|thurs|thu|thursday)', 'x'); break;
      case 6:day = XRegExp('(fri|friday)', 'x'); break;
      case 7:day = XRegExp('(sat|saturday)', 'x');break;
      default:
        throw new Error('got a strange day, is it Sunursnesday?: ' + searchDate.getWeekday());
    }
    switch (searchDate.getMonth()) {
      case 0: month = XRegExp('(jan|january)'); break;
      case 1: month = XRegExp('(feb|febuary)'); break;
      case 2: month = XRegExp('(mar|march)'); break;
      case 3: month = XRegExp('(apr|april)'); break;
      case 4: month = XRegExp('(may|may)'); break;
      case 5: month = XRegExp('(jun|june)'); break;
      case 6: month = XRegExp('(jul|july)'); break;
      case 7: month = XRegExp('(aug|august)'); break;
      case 8: month = XRegExp('(sep|september)'); break;
      case 9: month = XRegExp('(oct|october)'); break;
      case 10: month = XRegExp('(nov|november)'); break;
      case 11: month = XRegExp('(dec|december)'); break;
      default:
        throw new Error("it's martober: " + searchDate.getMonth());
    }
    /*ignore jslint end*/
  }

  return realAnalyzerFindDate.bind(null, searchDate);
};

/* PreBuilt Weighters */
exports.debugWeighter = function (dataList) {
  dataList.each(function (v) {
    v.weightedConfidence = v.confidence;
  });
};