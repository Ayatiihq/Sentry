
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
          logger.info('managed to scrape ' + self.results.length + ' torrents');
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
  var self = this;
  var albumTitle = self.campaign.metadata.albumTitle;
  var query = albumTitle.escapeURL(true);
  return query;
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
    self.storage.createFromURL(self.campaign._id,
                               torrent.name,
                               torrent.directLink,
                               {replace:false}, 
                               function(err){
                                  if(err)
                                    logger.warn("create from url issues : " + err);
                                  else
                                    logger.warn("create from url completed successfully");
                               });
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
      self.browser.find('table[class="data"]', this);
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
  this.infringements = new Infringements();
  this.wrangler =  new BasicWrangler();
  this.downloadDir_ = path.join(os.tmpDir(), 'bittorrent-page-analyser-' + utilities.genLinkKey(campaign.name));
};

util.inherits(PageAnalyser, BittorrentPortal);

PageAnalyser.prototype.beginSearch = function (browser) {
  var self = this 
    , respectableWorkLoad = []
    ;

  self.resultsCount = 0;
  browser.quit(); // don't need it.
  
  self.emit('started');
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
      logger.info('respectableWorkLoad length : ' + respectableWorkLoad.length);
      this();
    })
    .set(respectableWorkLoad)
    .seqEach(function(workItem){
      self.goWork(workItem, this);
    })
    .seq(function(){
      self.emit('finished');
    })
    .catch(function(err){
      self.emit('error', err);
    })
    ;
};

PageAnalyser.prototype.goWork = function (workItem, done) {
  var self  = this;

  self.wrangler.on('finished', function(results){
    var torrentTargets = results.map(function(item){return item.items.map(function(data){ return data.data})})[0];
    var filtered = torrentTargets.filter(function(link){return !link.startsWith('magnet:')}).unique();
    logger.info('Wrangler results FILTERED ' + JSON.stringify(filtered));
    var results = [];
    Seq(filtered)
      .seqEach(function(filteredResult){
        var that = this;
        self.processLink(filteredResult, function(err, keeper){
          results.push(keeper);
          that();
        });
      })
      .seq(function(){
        var that = this;
        var ofInterest = results.filter(function(result){return result.result});
        logger.info('finished processing ' + workItem.uri + ' found these of interest ' 
            + JSON.stringify(ofInterest));
        if(ofInterest.isEmpty()){
          self.infringements_.setStateBy(infringement, State.FALSE_POSITIVE, 'bittorrent-scraper-page-analyser', function(err){
            if (err)
              logger.warn('Error setting %s to FALSE_POSITIVE: %s', infringement.uri, err);
          });          
        }
        else{
          ofInterest.each(function(torrent){
            self.emit('torrent',
                      torrent.link,
                      {score: MAX_SCRAPER_POINTS / 1.5,
                       source: 'scraper.bittorrent.' + self.engineName,
                       message: 'Link to actual Torrent file from ' + self.engineName});
            self.emit('relation', workItem.uri, torrent.link);
          });
        }
        done();
      })
      .catch(function(err){
        done(err);
      })
      ;
  });

  self.wrangler.on('suspended', function onWranglerSuspend() {
    logger.info('wrangler suspended');
  });
  self.wrangler.on('resumed', function onWranglerResume() {
    logger.info('wrangler resumed');
  });
  
  self.wrangler.addRule(wranglerRules.rulesDownloadsTorrent);

  logger.info('go wrangle ' + workItem.uri);
  self.wrangler.beginSearch(workItem.uri);
}

PageAnalyser.prototype.processLink = function(torrentLink, done){
  var self = this
    , result = {link : torrentLink, result: false}
    ;

  Seq()
    .seq(function(){
      torrentInspector.getTorrentDetails(torrentLink, self.downloadDir_, this);
    })
    .seq(function(details_){
      if(details_){
        return torrentInspector.checkIfTorrentIsGoodFit(details_, self.campaign, this);
      }
      logger.warn('no details but no error ?');
      done(null, result);
    })
    .seq(function(good, reason){
      if(!good){
        logger.info('TorrentLink %s isn\'t a good fit: %s', torrentLink, reason);
        result.message = reason;
        return done(null, result); 
      }
      result.result = true;
      done(null, result);
    })
    .catch(function(err){
      logger.warn(err);
      result.message = err;
      done(null, result); // just ignore for now.
    })
    ;
}

/* Scraper Interface */
var Bittorrent = module.exports = function () {
  this.init();
};
util.inherits(Bittorrent, Scraper);

Bittorrent.prototype.init = function () {
  
};

//
// Overrides
//
Bittorrent.prototype.getName = function () {
  return "Bittorrent";
};

Bittorrent.prototype.start = function (campaign, job, browser) {
  var self = this;

  logger.info('started for %s', campaign.name);
  var scraperMap = {
    'kat': KatScraper,
    'pageAnalyser' : PageAnalyser
  };

  logger.info('Loading search engine: %s', job.metadata.engine);
  self.scraper = new scraperMap[job.metadata.engine](campaign, Campaigns.types());

  self.scraper.on('finished', function onFinished() {
    self.emit('finished');
  });

  self.scraper.on('error', function onError(err) {
    logger.warn('err : ' + err);
  });

  self.scraper.on('torrent', function onFoundTorrent(uri, points, metadata){
    self.emit('infringement', uri, points, metadata);
  });

  self.scraper.on('relation', function onFoundRelation(parent, child){
    self.emit('relation', parent, child);
  });

  self.scraper.beginSearch(browser);
};

Bittorrent.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

Bittorrent.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};