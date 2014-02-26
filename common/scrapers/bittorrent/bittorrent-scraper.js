
"use strict";
/*
 * bittorrent-scraper.js
 * (C) 2013 Ayatii Limited
 */
var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events') 
  , katparser = acquire('kat-parser')
  , logger = acquire('logger').forFile('bittorrent-scraper.js')
  , os = require('os')
  , path = require('path')
  , sugar = require('sugar')  
  , states = acquire('states')
  , torrentInspector = acquire('torrent-inspector')
  , util = require('util')
  , utilities = acquire('utilities') 
  , wranglerRules = acquire('wrangler-rules')
;

var BasicWrangler = acquire('basic-endpoint-wrangler').Wrangler
  , Campaigns = acquire('campaigns') 
  , Infringements = acquire('infringements') 
  , Promise = require('node-promise')
  , Scraper = acquire('scraper')
  , Seq = require('seq')
  , Settings = acquire('settings')    
  , Storage = acquire('storage')
  , URI = require('URIjs')    
  ;

var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 25;

var BittorrentPortal = function (campaign, types) {
  events.EventEmitter.call(this);
  var self = this;
  self.results = [];
  self.storage = new Storage('torrent');
  self.campaign = campaign;

  self.idleTime = [5, 10]; // min/max time to click next page
  self.resultsCount = 0;
  self.engineName = 'UNDEFINED';
  self.searchTerm = self.buildSearchQuery();
  self.campaignCategories = {};
  types.each(function(camType){
    self.campaignCategories[camType] = '';
  });
}

util.inherits(BittorrentPortal, events.EventEmitter);

BittorrentPortal.prototype.handleResults = function () {
  var self = this;

  Seq()
    .seq(function(){
      self.browser.wait(2500, this);    
    })
    .seq(function(){
      self.browser.getSource(this);
    })
    .seq(function(source){
      var newresults = self.getTorrentsFromResults(source);
      self.results = self.results.union(newresults);
      if (newresults.length < 1 && self.results.isEmpty()) {
        self.emit('error', ERROR_NORESULTS);
        self.cleanup();
        this();
      }
      else {
        if (self.checkHasNextPage(source)) {
          var randomTime = Number.random(self.idleTime[0], self.idleTime[1]);
          setTimeout(function(){self.nextPage(source);}, randomTime * 1000);
        }
        else {
          self.getTorrentsDetails();
          this();
        }
      }
    })
    .catch(function(err){
      self.emit('error', err);
    })
    ;
}

BittorrentPortal.prototype.buildSearchQuery = function () {
  var self = this;
  var queryBuilder = {
    'tv.live': self.buildSearchQueryTV.bind(self),
    'music.album': self.buildSearchQueryAlbum.bind(self),
    'music.track': self.buildSearchQueryTrack.bind(self),
    'movie': self.buildSearchQueryMovie.bind(self)
  };

  if (!Object.has(queryBuilder, self.campaign.type)) {
    self.emit('error', new Error('Campaign is of non excepted type: ' + self.campaign.type));
    return self.campaign.name;
  }
  else {
    return queryBuilder[self.campaign.type]();
  }
};

BittorrentPortal.prototype.buildSearchQueryTV = function () {
  var self = this;
  return self.campaign.name;
};

BittorrentPortal.prototype.buildSearchQueryAlbum = function () {
  var self = this
    , albumTitle = self.campaign.name.remove('-');
    ;

  if(self.campaign.metadata.noAlbumSearch && self.campaign.keywords){
    albumTitle = self.campaign.metadata.artist + ' ' + self.campaign.keywords.randomize().first();
  }

  return albumTitle.unescapeURL();
}

BittorrentPortal.prototype.buildSearchQueryMovie = function () {
  var self = this;
  var movieTitle = self.campaign.metadata.movieTitle;
  var query = movieTitle.escapeURL(true);
  return query;
}

BittorrentPortal.prototype.buildSearchQueryTrack = function () {
  var self = this;
  var trackTitle = self.campaign.metadata.albumTitle;
  var artist = self.campaign.metadata.artist;
  var query = util.format('"%s" "%s" %s', artist, trackTitle, self.keywords.join(' '));
  return query;
}

BittorrentPortal.prototype.cleanup = function () {
  var self = this;
  self.browser.quit(function(err){
    if(err)
      self.emit('error', err);
    self.emit('finished');
  });
}

BittorrentPortal.prototype.emitInfringements = function () {
  var self = this;
  self.results.each(function (torrent){
    self.emit('torrent',
               torrent.activeLink.uri,
               {score: MAX_SCRAPER_POINTS / 2,
                source: 'scraper.bittorrent.' + self.engineName,
                message: 'Torrent page at ' + self.engineName},
               {type: torrent.genre,
                leechers: torrent.leechers,
                seeders: torrent.seeders});                
    self.emit('torrent',
               torrent.directLink,
               {score: MAX_SCRAPER_POINTS / 1.5,
                source: 'scraper.bittorrent.' + self.engineName,
                message: 'Link to actual Torrent file from ' + self.engineName},
               {fileSize: torrent.fileSize,
                type: torrent.genre,
                leechers: torrent.leechers,
                seeders: torrent.seeders});
    self.emit('relation', torrent.activeLink.uri, torrent.directLink);
    if(torrent.magnet){
      self.emit('torrent',
                 torrent.magnet,
                 {score: MAX_SCRAPER_POINTS / 1.25,
                  source: 'scraper.bittorrent.' + self.engineName,
                  message: 'Torrent page at ' + self.engineName},
                 {fileSize: torrent.fileSize,
                  type: torrent.genre,
                  leechers: torrent.leechers,
                  seeders: torrent.seeders});
      self.emit('relation', torrent.activeLink.uri, torrent.magnet);
      self.emit('relation', torrent.magnet, torrent.hash_ID);
    }
    self.emit('torrent',
               torrent.hash_ID,
               {score: MAX_SCRAPER_POINTS, 
                source: 'scraper.bittorrent' + self.engineName,
                message: 'Torrent hash scraped from ' + self.engineName},
               {fileSize: torrent.fileSize, fileData: torrent.fileData.join(', '),
                type: torrent.genre,
                leechers: torrent.leechers,
                seeders: torrent.seeders});                
    self.emit('relation', torrent.directLink, torrent.hash_ID);

  });
  self.cleanup();
}

BittorrentPortal.prototype.beginSearch = function () {
  throw new Error('Stub!');
}

BittorrentPortal.prototype.getTorrentsFromResults = function (source) {
  throw new Error('Stub!');
}

BittorrentPortal.prototype.getTorrentsDetails = function (source) {
  throw new Error('Stub!');
}

// clicks on the next page, waits for new results
BittorrentPortal.prototype.nextPage = function () {
  throw new Error('Stub!');
}

BittorrentPortal.prototype.checkHasNextPage = function (source) {
  throw new Error('Stub!');
}

/* -- KAT Scraper */
var KatScraper = function (campaign, types) {
  var self = this;
  self.constructor.super_.call(self, campaign, types);
  self.engineName = 'kat';
  self.root = 'http://www.katproxy.com';
};

util.inherits(KatScraper, BittorrentPortal);

KatScraper.prototype.beginSearch = function (browser) {
  var self = this;
  self.resultsCount = 0;
  self.browser = browser;
  self.emit('started');
  Seq()
    .seq(function(){
      self.browser.get(self.root, this);     
    })
    .seq(function(){
      self.browser.wait(2000, this);    
    })
    .seq(function(){
      self.searchQuery(1);//pageNumber
      this();
    })
    .catch(function(err){
      self.emit('error', err);
    })
    ;  
};

KatScraper.prototype.searchQuery = function(pageNumber){
  var self = this;
  self.campaignCategories.movie = '%20category%3Amovies/';
  self.campaignCategories['music.album'] = '%20category%3Amusic/';

  var queryString = self.root +
                    '/usearch/' + 
                    self.searchTerm +  
                    self.campaignCategories[self.campaign.type] + 
                    pageNumber + '/' + 
                    "?field=time_add&sorder=desc";
  Seq()
    .seq(function(){
      self.browser.get(queryString, this);    
    })
    .seq(function(){
      var that = this;
      self.browser.find('table[class="data"]', function(err){
        if(err){
          logger.info("No search results for " + self.searchTerm.unescapeURL(true) + ' on ' + self.engineName);
          return self.cleanup();
        }
        that();
      });
    })
    .seq(function(){
      self.handleResults();
      this();      
    })
    .catch(function(err){
      logger.error('Unable to get ' + queryString + ' - ' + err);
      self.cleanup();
    })
    ;
}

KatScraper.prototype.getTorrentsDetails = function(){
  var self = this;
  function torrentDetails(torrent){
    function goGetIt(prom){
      Seq()
        .seq(function(){
          self.browser.get(torrent.activeLink.uri, this);
        })
        .seq(function(){
          self.browser.getSource(this);
        })
        .seq(function(source){    
          katparser.torrentPage(source, torrent);
          prom.resolve();
          this();
        })
        .catch(function(err){
          prom.reject(err);
        })
        ;
    }
    var promise = new Promise.Promise;
    var randomTime = Number.random(self.idleTime[0], self.idleTime[1]);
    setTimeout(function(){ goGetIt(promise);}, randomTime * 1000);
    return promise;
  }
  var promiseArray;
  promiseArray = self.results.map(function(r){ return torrentDetails.bind(self, r)});
  Promise.seq(promiseArray).then(function(){
    self.emitInfringements();
  }); 
}

KatScraper.prototype.getTorrentsFromResults = function (source) {
  var self = this;
  return katparser.resultsPage(source, self.campaign)
};

KatScraper.prototype.nextPage = function (source) {
  var self = this;
  var result = katparser.paginationDetails(source);
  self.searchQuery(result.currentPage + 1);
};

KatScraper.prototype.checkHasNextPage = function (source) {
  var self = this;
  var result = katparser.paginationDetails(source);
  if(result.otherPages.isEmpty() || (result.otherPages.max() < result.currentPage))
    return false;
  return true; 
};

/* -- TorrentPageAnalyser */
var PageAnalyser = function (campaign, types) {
  this.constructor.super_.call(this, campaign, types);
  this.engineName = 'pageAnalyser';
  this.downloadDir_ = '';
  this.infringements = null;
  this.wrangler = null;
};

util.inherits(PageAnalyser, BittorrentPortal);

PageAnalyser.prototype.beginSearch = function (browser) {
  var self = this 
    , respectableWorkLoad = []
    ;

  self.resultsCount = 0;
  self.emit('started');
  
  browser.quit(); // don't need it.  
  
  self.infringements = new Infringements();
  self.downloadDir_ = path.join(os.tmpDir(), 'bittorrent-page-analyser-' + utilities.genLinkKey(self.campaign.name));

  Seq()
    .seq(function(){
      utilities.tryMakeDir(self.downloadDir_, this);
    })
    .seq(function(){
      self.infringements.getTorrentPagesUnverified(self.campaign, this);
    })
    .seq(function(torrentPagesUnverified_){
      torrentPagesUnverified_.sort(function(a, b ){return a.created < b.created});
      //be careful not to trip that seq stack bug 
      respectableWorkLoad.add(torrentPagesUnverified_.slice(0, 50)); 
      this();
    })
    .set(respectableWorkLoad)
    .seqEach(function(workItem){
      setTimeout(self.goWork.bind(self, workItem, this), 5000);
    })
    .catch(function(err){
      self.emit('error', err);
    })
    .seq(function(){
      self.emit('finished');
    })    
    ;
};

PageAnalyser.prototype.goWork = function (infringement, done) {
  var self = this
    , keepers = []
    ;

  Seq()
    .seq(function(){
      self.wrangleLink(infringement.uri, this);
    })
    .seq(function(wranglerResults){
      self.processLinks(wranglerResults, this);
    })
    .seq(function(processed){
      keepers = keepers.union(processed.keepers);
      self.wrangleLinks(processed.needAnotherLook, this);
    })
    .seq(function(secondPassWrangled){
      self.processLinks(secondPassWrangled, this);
    })
    .seq(function(secondPassProcessed){
      keepers = keepers.union(secondPassProcessed.keepers);
    })
    .seq(function(){
      if(!keepers.isEmpty())
        return self.broadcast(ofInterest, infringement, this);
      
      // otherwise mark as false positive.
      self.emit('decision',
                infringement,
                states.infringements.state.FALSE_POSITIVE);
      this();
    })         
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

PageAnalyser.prototype.wrangleLinks = function(links, done){
  var self = this;
  var results = [];
  Seq(links)
    .seqEach(function(link){
      var that = this;
      self.wrangleLink(link, function(err, result){
        if(err || !result) // ignore both errors and no result
          return that();
        results = results.union(result);
        that();
      });
    })
    .seq(function(){
      done(null, results);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

PageAnalyser.prototype.processLinks = function(links, done){
  var self = this;
  results = {keepers : [], needAnotherLook : []};

  Seq(links)
    .seqEach(function(link){
      var that = this;
      self.processLink(link, function(err, result){
        if(err || !result) // ignore both errors and no result
          return that();
        // its gotta be one of the two keys in results
        results[Object.keys(result).first()].push(Object.values(result).first());
        that();
      });
    })
    .seq(function(){
      done(null, results);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

PageAnalyser.prototype.processLink = function(torrentLink, done){
  var self = this;

  Seq()
    .seq(function(){
      torrentInspector.getTorrentDetails(torrentLink, self.downloadDir_, this);
    })
    .seq(function(details_){
      if(details_.success){
        return torrentInspector.checkIfTorrentIsGoodFit(details_.torDetails, self.campaign, this);
      }
      if(details_.message === 'Not binary'){
        logger.info('found a torrent link which links to page and not a torrent ' + torrentLink);
        return done(null, {needAnotherLook : torrentLink});
      }
    })
    .seq(function(good, reason){
      if(!good){
        logger.info('TorrentLink %s isn\'t a good fit: %s', torrentLink, reason);
        return done();
      }
      done(null, {keepers : torrentLink});
    })
    .catch(function(err){
      logger.warn('Torrent error', torrentLink, err);
      done(); // just ignore for now.
    })
    ;
}


PageAnalyser.prototype.wrangleLink = function (targetLink, done) {
  var self  = this;

  if (self.wrangler) { // remove all listeners if a wrangler object was used previously
    self.wrangler.removeAllListeners('finished')
                 .removeAllListeners('suspended')
                 .removeAllListeners('resumed');
    self.wrangler = null;
  }

  self.wrangler = new BasicWrangler();
  self.wrangler.addRule(wranglerRules.rulesDownloadsTorrent);

  self.wrangler.on('finished', function(results){
    if(!results || results.isEmpty()){
      return done();
    }
    var torrentTargets = results.map(function(item){return item.items.map(function(data){ return data.data})})[0];
    var filtered = torrentTargets.filter(function(link){return !link.startsWith('magnet:')}).unique();
    //logger.info('This is what wrangler returned ' + JSON.stringify(filtered));
    done(null, filtered);
  });

  self.wrangler.on('suspended', function onWranglerSuspend() {
  });
  self.wrangler.on('resumed', function onWranglerResume() {
  });

  self.wrangler.beginSearch(targetLink);          
}

PageAnalyser.prototype.broadcast = function(results, infringement, done){
  var self = this;
  Seq(results)
    .seqEach(function(torrent){
      if (!torrent.link) 
        return this();

      self.emit('torrent',
                torrent.link,
                {score: MAX_SCRAPER_POINTS / 1.5,
                 source: 'scraper.bittorrent.' + self.engineName,
                 message: 'Link to actual Torrent file from ' + self.engineName});
      self.emit('relation', infringement.uri, torrent.link);
      this();
    })
    .seq(function(){
      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/* Scraper Interface */
var Bittorrent = module.exports = function () {
  this.init();
};

util.inherits(Bittorrent, Scraper);

Bittorrent.prototype.init = function () {};

//
// Overrides
//
Bittorrent.prototype.getName = function () {
  return "Bittorrent";
};

Bittorrent.prototype.start = function (campaign, job, browser) {
  var self = this;

  logger.info('started for %s', campaign.name);
  var engineMap = {
    'kat': KatScraper,
    'pageAnalyser' : PageAnalyser
  };

  logger.info('Loading search engine: %s', job.metadata.engine);
  self.engine = new engineMap[job.metadata.engine](campaign, Campaigns.types());

  self.engine.on('finished', function onFinished() {
    self.emit('finished');
  });

  self.engine.on('error', function onError(err) {
    logger.warn('err : ' + err);
  });

  self.engine.on('torrent', function onFoundTorrent(uri, points, metadata){
    if(uri._string){
      logger.warn('torrent signal with a dodgy uri ' + JSON.stringify(uri._string));
      return;
    }
    self.emit('infringement', uri, points, metadata);
  });

  self.engine.on('relation', function onFoundRelation(parent, child){
    self.emit('relation', parent, child);
  });

  self.engine.on('started', function onStarted(){
    self.emit('started');
  })
  
  self.engine.on('decision', function onDecisionMade(infringement, newState){
    //self.emit('infringementStateChange', infringement, newState);
  });

  self.engine.beginSearch(browser);
};

Bittorrent.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Bittorrent.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};