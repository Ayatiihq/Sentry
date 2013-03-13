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
      case 0:day = '(sun|sunday)'; break;
      case 2:day = '(mon|monday)'; break;
      case 3:day = '(tue|tuesday)'; break;
      case 4:day = '(wed|wednesday)'; break;
      case 5:day = '(thur|thurs|thu|thursday)'; break;
      case 6:day = '(fri|friday)'; break;
      case 7:day = '(sat|saturday)';break;
      default:
        throw new Error('got a strange day, is it Sunursnesday?: ' + searchDate.getWeekday());
    }
    switch (searchDate.getMonth()) {
      case 0: month = '(jan|january)'; break;
      case 1: month = '(feb|febuary)'; break;
      case 2: month = '(mar|march)'; break;
      case 3: month = '(apr|april)'; break;
      case 4: month = '(may|may)'; break;
      case 5: month = '(jun|june)'; break;
      case 6: month = '(jul|july)'; break;
      case 7: month = '(aug|august)'; break;
      case 8: month = '(sep|september)'; break;
      case 9: month = '(oct|october)'; break;
      case 10: month = '(nov|november)'; break;
      case 11: month = '(dec|december)'; break;
      default:
        throw new Error("it's martober: " + searchDate.getMonth());
    }
    /*ignore jslint end*/
    var startWhitespace = '( |^|\\.)';
    var endWhitespace = '( |$|\\.)';
    day = XRegExp(startWhitespace + day + endWhitespace, 'i');
    month = XRegExp(startWhitespace + month + endWhitespace, 'i');
    year = XRegExp(startWhitespace + searchDate.getFullyear() + endWhitespace, 'i');
    
    var redateandmonth = XRegExp.exec('12/12/12', XRegExp('([0-9]{1,2})[-/]([0-9]{1,2})(?:[-/]([0-9]{1,2}))?'));

  }

  return realAnalyzerFindDate.bind(null, searchDate);
};

/* PreBuilt Weighters */
exports.debugWeighter = function (dataList) {
  dataList.each(function (v) {
    v.weightedConfidence = v.confidence;
  });
};