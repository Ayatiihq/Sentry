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
  , XRegExp = require('XRegExp').XRegExp
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

ConfidenceAggregator.prototype.getData = function () {
  var self = this;
  return self.dataList();
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
      publishTime: self.getPublishTime(data.datum)
    };

    data.confidence += analyzer(datumContainer) * analyzerContainer.weight;
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
  return Math.random();
};

function findsInTexts(texts, finds) {
  // texts and finds are both arrays, texts should be strings, finds can be strings or arrays, looks for finds in texts
  return texts.some(function (text) {
    return finds.some(function (find) {
      XRegExp(find).test(text);  //ignore jslint
    });
  });
}

exports.analyzerLargeDurations = function (length) {
  return function (duration, datum) {
    return (datum.duration > duration) ? 1 : 0;
  }.bind(null, length);
};

exports.analyzerKeywords = function (_optionalKeywords, _requiredKeywords) {
  return function (optionalKeywords, requiredKeywords, datum) {
    var fullText = (datum.title + ' ' + datum.description).toLowerCase();
    var score = 0.0;

    var optionalCount = optionalKeywords.count(function (keyword) { return fullText.has(keyword.toLowerCase()); });
    // we only care about finding around three items from the optional keywords list, we find three then its a success.
    optionalCount = Math.min(optionalCount, 300) / Math.min(optionalKeywords.length, 300); // normalize

    if (Object.isArray(requiredKeywords)) {
      var hasRequired = requiredKeywords.all(function (keyword) { return fullText.has(keyword.toLowerCase()); });
      score = (0.5 + (0.5 * optionalCount)) * hasRequired;
    }
    else {
      // no required keywords so just run off optional keywords
      score = optionalCount;
    }
      
    return score;
  }.bind(null, _optionalKeywords, _requiredKeywords);
};

exports.analyzerFindDate = function (date) {
  return function (searchDate, datum) {
    var redateandmonth = new XRegExp('([0-9]{1,2})[-/]([0-9]{1,2})(?:[-/]([0-9]{1,2}))?');

    var possibleDates = []; // contains all the possible dates that could be referenced in the video
    var fullText = datum.title + datum.description;

    var damMatch = XRegExp.exec(fullText, redateandmonth);
    if (!!damMatch) {
      var expandYear = function (s) {
        if (s.length === 4) { return s; }
        else {
          if (parseInt(s, 10) < 30) { return '20' + s; }
          else { return '19' + s; }
        }
      };
      
      possibleDates.push(new Date(datum.publishTime.getFullYear(), damMatch[1], damMatch[2]));      //mm/dd
      possibleDates.push(new Date(datum.publishTime.getFullYear(), damMatch[2], damMatch[1]));      //dd/mm
      if (!!damMatch[3]) { // got three components 
        possibleDates.push(new Date(expandYear(damMatch[1]), damMatch[2], damMatch[3]));            //yy/mm/dd
        possibleDates.push(new Date(expandYear(damMatch[1]), damMatch[3], damMatch[2]));            //yy/dd/mm
        possibleDates.push(new Date(expandYear(damMatch[3]), damMatch[1], damMatch[2]));            //mm/dd/yy
        possibleDates.push(new Date(expandYear(damMatch[3]), damMatch[2], damMatch[1]));            //dd/mm/yy
      }
    }
    var foundDateMatch = possibleDates.some(searchDate.is.bind(searchDate));
    // found a matching date, full confidence. seems rare. 
    if (foundDateMatch) {
      return 1;
    }
    else {
      // no date match, look for date componenets 
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
      day = new XRegExp(startWhitespace + day + endWhitespace, 'i');
      month = new XRegExp(startWhitespace + month + endWhitespace, 'i');
      year = new XRegExp(startWhitespace + searchDate.getFullYear() + endWhitespace, 'i');

      var score = 0.0;
      score += (XRegExp.test(fullText, day))    ? 0.4 : 0.0;
      score += (XRegExp.test(fullText, month))  ? 0.4 : 0.0;
      score += (XRegExp.test(fullText, year)) ? 0.2 : 0.0;

      return score;
    }
  }.bind(null, date);
};

/* PreBuilt Weighters */
exports.nullWeighter = function (dataList) {
  dataList.each(function (v) {
    v.weightedConfidence = v.confidence;
  });
};

exports.gaussianWeighter = function (dataList) {
  // really dumb hard-coded values
  for (var i = 0; i < dataList.length; i++) {
    var NK9_0 = 0.17857142857142855;
    var NK9_1 = 0.1607142857142857;
    var NK9_2 = 0.14285714285714285;
    var NK9_3 = 0.071428571428571425;
    var NK9_4 = 0.035714285714285712;
    var v1 = dataList[Math.abs((i - 4) % dataList.length)].confidence * NK9_4;
    var v2 = dataList[Math.abs((i - 3) % dataList.length)].confidence * NK9_3;
    var v3 = dataList[Math.abs((i - 2) % dataList.length)].confidence * NK9_2;
    var v4 = dataList[Math.abs((i - 1) % dataList.length)].confidence * NK9_1;
    var v5 = dataList[Math.abs((i + 0) % dataList.length)].confidence * NK9_0;
    var v6 = dataList[Math.abs((i + 1) % dataList.length)].confidence * NK9_1;
    var v7 = dataList[Math.abs((i + 2) % dataList.length)].confidence * NK9_2;
    var v8 = dataList[Math.abs((i + 3) % dataList.length)].confidence * NK9_3;
    var v9 = dataList[Math.abs((i + 4) % dataList.length)].confidence * NK9_4;

    dataList[i].weightedConfidence = v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8 + v9;
  }
};