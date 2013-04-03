/*
 * A wrapper around torrents on isoHunt
 * (C) 2013 Ayatii Limited
 */
require('request');
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('IsoHunt/index.js')
  , util = require('util')
  , cheerio = require('cheerio')
  , sugar = require('sugar')
  , URI = require('URIjs')
  , Promise = require('node-promise').Promise
  , webdriver = require('selenium-webdriver')
  , Settings = acquire('settings')  
;

var TorrentDescriptor = module.exports.TorrentDescriptor = function(name, link) 
{
  this.init(name, link);
}

TorrentDescriptor.prototype.init = function(name, link)
{
  var self = this;
  self.name = name;
  self.initialLink = link; // 
  self.fileLink = null; // link to torrent
  self.date = Date.now(); // date it was published on the torrent service
  self.info_hash = null; // info_hash of the torrent
}
