/*
 * A wrapper around torrents on isoHunt
 * (C) 2013 Ayatii Limited
 * TODO refactor this and tv-channel.js into the one file => spider-entity.js or spidered.js
 */
require('enum').register();
var acquire = require('acquire')
  , events = require('events')
  , logger = acquire('logger').forFile('comment/TorrentDescriptor.js')
  , utilities = acquire('utilities')
;

var TorrentDescriptorStates = module.exports.TorrentDescriptorStates = new Enum(['SCRAPING',
                                                                                 'DOWNLOADING',
                                                                                 'END_OF_THE_ROAD']);

var TorrentDescriptor = module.exports.TorrentDescriptor = function(name, link) 
{
  this.init(name, link);
}


TvChannel.prototype.constructLink = function(extraMetadata, childLink){
  var self = this;
  var link;
  
  if(!childLink){
    logger.error('%s - constructLink got passed a null link %s', self.name, extraMetadata);
    return false;
  }

  link = {channel: self.name,
          genre: self.genre,
          type: self.type,
          source: self.source,
          uri: childLink,
          parent: self.activeLink.uri,
          metadata: extraMetadata};
  var archive = Object.clone(extraMetadata);
  archive.uri = childLink;
  self.links.push(archive);
  self.moveToNextLink();
  return link;
}

TorrentDescriptor.prototype.init = function(name, link)
{
  var self = this;
  self.name = name;
  self.initialLink = link; // scraped from category page 
  self.fileLink = null;    // link to torrent
  // Date it was published on the torrent service
  // Set at init time, should be reset when the date is parsed from page
  self.date = Date.now();  
  self.info_hash = null;   // info_hash of the torrent
  self.currentState = TorrentDescriptorStates.SCRAPING;
}

TorrentDescriptor.prototype.emitLink = function(spider, link)