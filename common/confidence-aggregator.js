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
  , util = require('util')
  , Promise = require('node-promise')
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

/* PreBuilt Weighters */
exports.debugWeighter = function (dataList) {
  dataList.each(function (v) {
    v.weightedConfidence = v.confidence;
  });
};