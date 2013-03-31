/*
 * A wrapper around torrents on isoHunt
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('IsoHunt/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , request = require('request')
  , sugar = require('sugar')
  , URI = require('URIjs')
  , Promise = require('node-promise').Promise
  , webdriver = require('selenium-webdriver')
  , Settings = acquire('settings')  
;

var TorrentDescriptor = module.exports = function() {
  this.init();
}

TorrentDescriptor.init = function(name, link)
{
  var self = this;
  self.name = name;
  self.initialLink = link;
  self.date;
}
