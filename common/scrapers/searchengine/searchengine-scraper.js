"use strict";
/*
 * google.js: a google scraper
 *
 * (C) 2012 Ayatii Limited
 *
 * Scraper that can scrape all types of media and always takes 5mins to complete
 * it's job. It can be paused and, if so, it will resume it's five minute
 * timeout.
 *
 */

var acquire = require('acquire')
  , blacklist = acquire('blacklist')
  , cheerio = require('cheerio')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('searchengine-scraper.js')
  , request = require('request')
  , Seq = require('seq')  
  , sugar = require('sugar')
  , URI = require('URIjs')
  , urlmatch = acquire('wrangler-rules').urlMatch
  , util = require('util')
  , utilities = acquire('utilities')
  , XRegExp = require('xregexp').XRegExp
  ;

var Scraper = acquire('scraper')
  , Seq = require('seq')
  , Settings = acquire('settings')
  ;

var ERROR_NORESULTS = "No search results found after searching";
var MAX_SCRAPER_POINTS = 50;

var GenericSearchEngine = function (campaign) {
  events.EventEmitter.call(this);
  var self = this;
  self.campaign = campaign;
  self.settings = new Settings('scraper.searchengine');
  
  self.idleTime = [5, 10]; // min/max time to click next page
  self.resultsCount = 0;
  self.engineName = 'UNDEFINED';
  self.maxPages = campaign.metadata.searchengineMaxPages ? campaign.metadata.searchengineMaxPages : 15;
  self.pageNumber = 1;
  self.blacklistCombined = blacklist.safeDomains.union(self.campaign.metadata.blacklist);
  self.oldestResultDate = Date.create(campaign.metadata.releaseDate).rewind({ week: 1 });
  self.buildWordMatchess();
};
util.inherits(GenericSearchEngine, events.EventEmitter);

GenericSearchEngine.prototype.buildWordMatchess = function() {
  var self = this
    , campaign = self.campaign
    ;

  self.excludeWordMatches =  [];
  self.includeMatchMatches = [];

  // First let's do excluded words
  campaign.metadata.lowPriorityWordList.forEach(function(word) {
    // They are already regex aware
    self.excludeWordMatches.push(new RegExp(word, 'i'));
  });

  // Load up the simple ones first
  self.includeMatchMatches.push(new RegExp(utilities.buildLineRegexString(campaign.name, { anyWord: false }), 'i'));
  if(campaign.keywords){
    campaign.keywords.forEach(function(name) {
      self.includeMatchMatches.push(new RegExp(utilities.buildLineRegexString(name, { anyWord: false }), 'i'));
    });
  }
  // until we migrate to keyword.
  if(campaign.names){
    campaign.names.forEach(function(name) {
      self.includeMatchMatches.push(new RegExp(utilities.buildLineRegexString(name, { anyWord: false }), 'i'));
    });
  }

  if (campaign.type == 'movie') {
    // Nothing special yet for movies

  } else if (campaign.type == 'music.album') {
    self.includeMatchMatches.push(new RegExp(utilities.buildLineRegexString(campaign.metadata.artist, { anyWord: false }), 'i'));    
    campaign.metadata.assets.forEach(function(track) {
      self.includeMatchMatches.push(new RegExp(utilities.buildLineRegexString(track.title, { anyWord: false }), 'i'));
    });
  } else {
    logger.warn('Campaign type %s has no special case word lists', campaign.type);
  }
}


GenericSearchEngine.prototype.handleResults = function () {
  var self = this
    , source = null
  ;

  // we sleep 2500ms first to let the page render
  Seq()
    .seq(function(){
      self.browser.wait(2500, this);
    })
    .seq(function(){
      self.browser.getSource(this);
    })
    .seq(function(source_){
      source = source_
      self.getLinksFromSource(source, this);
    })
    .seq(function(newresults){
      if (newresults.length < 1) {
        logger.info("We found results but they were irrelevant due to date, url or title\n");
        return this();
      }
      var filteredResults = self.filterSearchResults(newresults);
      if(filteredResults.isEmpty()){ 
        logger.info('Any results we found were filtered out due to blacklists'); 
        return this();
      }
      //logger.info('results ' + JSON.stringify(newresults));
      self.emitLinks(filteredResults);
      this();
    })
    .seq(function(){
      if (self.checkHasNextPage(source)) {
        var randomTime = Number.random(self.idleTime[0], self.idleTime[1]);
        setTimeout(function () {
          self.nextPage();
        }, randomTime * 1000);
      }
      else {
        logger.info('No next page, finished scraping succesfully');
        self.cleanup();
      }        
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
}

GenericSearchEngine.prototype.filterSearchResults = function(scrapedLinks){
  var self = this;
  var filterOnBlackList = function(scrapedLink){
    try{
      var uriInstance = URI(scrapedLink);
    }
    catch(error){
      logger.error('Unable to create URI from scraped link ' + error);
      return false;
    }
    return !self.blacklistCombined.some(uriInstance.domain());
  }
  return scrapedLinks.filter(filterOnBlackList);
}

GenericSearchEngine.prototype.buildSearchQuery = function (done) {
  var self = this;
  var searchTerm = "";
  var queryBuilder = {
    'tv.live': self.buildSearchQueryTV.bind(self),
    'music.album': self.buildSearchQueryAlbum.bind(self),
    'music.track': self.buildSearchQueryTrack.bind(self),
    "movie": self.buildSearchQueryMovie.bind(self)
  };

  if (!Object.has(queryBuilder, self.campaign.type)) {
    self.emit('error', new Error('Campaign is of non excepted type: ' + self.campaign.type));
    done(null, self.campaign.name);
  }
  else {
    queryBuilder[self.campaign.type](done);
  }
};

GenericSearchEngine.prototype.buildSearchQueryTV = function (done) {
 var self = this
    , fmt = util.format
    , channelName = '\"' + self.campaign.metadata.channelName + '\"'
    , key = fmt('%s.%s.runNumber', self.engineName, self.campaign.name)
    , searchTerms = []
    ;

  searchTerms.push(fmt('%s watch online'));
  searchTerms.push(fmt('%s watch live online'));
  searchTerms.push(fmt('%s watch live online free'));
  searchTerms.push(fmt('%s live online'));
  searchTerms.push(fmt('%s live stream'));
  searchTerms.push(fmt('%s live stream free'));
  searchTerms.push(fmt('%s free online stream'));
  
  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);

    done(null, searchTerms[run % searchTerms.length]);
  });  
};


// Remove terms whose prefix already is in the terms array
// i.e. ["Foo Bar", "Foo Bar (remix)"] => ["Foo Bar"]
// This avoids us hitting search term limits on search engines
GenericSearchEngine.prototype.removeRedundantTerms = function(terms) {
  var self = this
    , ret = []
    ;

  terms.forEach(function(term) {
    var hasPrefix = false;
    ret.forEach(function(prefix) {
      if (term.indexOf(prefix) == 0)
        hasPrefix = true;
    });

    if (!hasPrefix)
      ret.push(term);
  });

  return ret;
}

GenericSearchEngine.prototype.buildSearchQueryTrack = function (done) {
  var self = this;
  var trackTitle = '\"' + self.campaign.metadata.albumTitle + '\"';
  var artist = '\"' + self.campaign.metadata.artist + '\"';

  var query = util.format('"%s" "%s" %s', artist, trackTitle, 'download');
  done(null, query);
};

GenericSearchEngine.prototype.buildSearchQueryMovie = function(done) {
  var self = this
    , movieTitle = '\"' + self.campaign.metadata.movieTitle + '\"'
    , year = self.campaign.metadata.year
    , fmt = util.format
    , key = fmt('%s.%s.runNumber', self.engineName, self.campaign.name)
    , searchTerms = []
    , searchTerms1 = []
    , searchTerms2 = []
    , searchTerms3 = []
    , language = self.campaign.metadata.language
    ;

  searchTerms1.push(fmt('%s movie download', movieTitle));
  searchTerms2.push(fmt('%s %s movie download', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s movie download', movieTitle, language));

  searchTerms1.push(fmt('%s movie torrent', movieTitle));
  searchTerms2.push(fmt('%s %s movie torrent', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s movie torrent', movieTitle, language));

  searchTerms1.push(fmt('%s watch online', movieTitle));
  searchTerms2.push(fmt('%s %s watch online', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s watch online', movieTitle, language));

  searchTerms1.push(fmt('%s online free', movieTitle));
  searchTerms2.push(fmt('%s %s online free', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s online free', movieTitle, language));

  searchTerms1.push(fmt('%s free download', movieTitle));
  searchTerms2.push(fmt('%s %s free download', movieTitle, year));
  if (language != 'english')
    searchTerms3.push(fmt('%s %s free download', movieTitle, language));

  ['bdrip', '720p', 'screener', 'dvdrip', 'cam', 'scam rip'].forEach(function(type) {
    searchTerms1.push(fmt('%s %s download', movieTitle, type));
    searchTerms2.push(fmt('%s %s %s download', movieTitle, year, type));
    if (language != 'english')
      searchTerms3.push(fmt('%s %s %s download', movieTitle, language, type));
  });

  // Compile the list
  searchTerms = searchTerms1.add(searchTerms2);
  searchTerms = searchTerms.add(searchTerms3);

  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);

    done(null, searchTerms[run % searchTerms.length]);
  });  
}

GenericSearchEngine.prototype.buildSearchQueryAlbum = function (done) {
  var self = this
    , albumTitle = '\"' + self.campaign.metadata.albumTitle + '\"'
    , artist = '\"' + self.campaign.metadata.artist + '\"'
    , fmt = util.format
    , key = fmt('%s.%s.runNumber', self.engineName, self.campaign.name)
    , searchTerms = []
    , searchTerms1 = []
    , searchTerms2 = []
    , soundtrack = self.campaign.metadata.soundtrack
    , compilation = self.campaign.metadata.compilation
    , assets = self.campaign.metadata.assets.map(function(track){return '\"' + getValFromObj('title', track) + '\"'});
    ;

  if(self.campaign.keywords &&
    !self.campaign.keywords.isEmpty() &&
     self.campaign.metadata.noAlbumSearch){
    albumTitle =  '\"' + self.campaign.keywords.randomize().first() + '\"';
  }

  if (soundtrack) {
    searchTerms1.push(fmt('+%s song download', albumTitle));
    searchTerms1.push(fmt('+%s songs download', albumTitle));
    searchTerms1.push(fmt('+%s mp3 torrent', albumTitle));
    searchTerms2.push(fmt('+%s mp3', albumTitle));
  
  } else if (compilation) {
    searchTerms1.push(fmt('%s download', albumTitle));
    searchTerms1.push(fmt('%s torrent', albumTitle));
    searchTerms1.push(fmt('%s mp3', albumTitle));
  
  } else {
    searchTerms1.push(fmt('+%s %s download', artist, albumTitle));
    searchTerms1.push(fmt('+%s %s torrent', artist, albumTitle));
    searchTerms1.push(fmt('+%s %s mp3', artist, albumTitle));
    searchTerms1.push(fmt('+%s %s mp3 download', artist, albumTitle));
    searchTerms1.push(fmt('+%s %s lossless', artist, albumTitle));
    searchTerms1.push(fmt('+%s %s flac', artist, albumTitle));
  }
  
  var searchableTracks = self.campaign.metadata.assets.filter(function(asset){return !asset.noSearch});

  // Now the assets
  searchableTracks.each(function(asset){
    var track = '\"' + getValFromObj('title', asset) + '\"';
    if (soundtrack) {
      // Just add track and album (disregard artist)
      searchTerms2.push(fmt('+%s %s song download', track, albumTitle));
      searchTerms2.push(fmt('+%s %s mp3', track, albumTitle));
      searchTerms2.push(fmt('+%s %s flac', track, albumTitle));                
      searchTerms2.push(fmt('+%s %s lossless', track, albumTitle));                        
    }
    else{
      searchTerms2.push(fmt('+%s %s %s download', artist, albumTitle, track));
      searchTerms2.push(fmt('+%s %s %s free mp3 download', artist, albumTitle, track));
      searchTerms2.push(fmt('+%s %s %s mp3 download', artist, albumTitle, track));        
      searchTerms2.push(fmt('+%s %s %s flac', artist, albumTitle, track));
      searchTerms2.push(fmt('+%s %s %s lossless', artist, albumTitle, track));        
    }
  });

  // Compile the list
  searchTerms = searchTerms1.add(searchTerms2);

  // Figure out the current run from settings
  self.settings.get(key, function(err, run) {
    if (err)
      return done(err);

    run = run ? run : 0; // Convert into number

    // Update it for next run
    self.settings.set(key, run + 1);

    done(null, searchTerms[run % searchTerms.length]);
  });
};

GenericSearchEngine.prototype.cleanup = function () {
  var self = this;
  Seq()
    .seq(function(){
      if(!self.browser)
        return this();
      self.browser.quit(this);
    })
    .seq(function(){
      self.emit('finished');
      this();
    })
    .catch(function(err){
      self.emit('ERROR', err);
    })
    ;
};

GenericSearchEngine.prototype.emitLinks = function (linkList) {
  var self = this;

  linkList.each(function linkEmitter(link) {
    if (!link || link[0] === '/') { return; }

    var linkScore = Math.max(1.0, MAX_SCRAPER_POINTS * (1.0 - self.resultsCount / 100));

    self.emit('found-link', link,
      {
        engine: self.engineName,
        score: linkScore,
        message: "Engine result",
        source: 'scraper.' + self.engineName
      });

    self.resultsCount++;
  });
  logger.trace(self.engineName + ' just emitted ' + linkList.length + ' links.');
};

GenericSearchEngine.prototype.beginSearch = function () {
  throw new Error('Stub!');
};


GenericSearchEngine.prototype.getLinksFromSource = function (source, done) {
  throw new Error('Stub!');
};

// clicks on the next page, waits for new results
GenericSearchEngine.prototype.nextPage = function () {
  throw new Error('Stub!');
};

GenericSearchEngine.prototype.checkHasNextPage = function (source) {
  throw new Error('Stub!');
};

GenericSearchEngine.prototype.checkResultRelevancy = function(title, url, date) {
  var self = this
    , matchString = utilities.simplifyForRegex(title + ' ' + url)
    ;

  // First let's check the date as it's the fastest way to discriminate
  if (Object.isDate(date) && date.isBefore(self.oldestResultDate)) {
    return false;
  }

  // We don't like noticing entire websites
  if (!utilities.uriHasPath(url)) {
    return false;
  } 

  // Then check if any of the excluded words are in the title or url
  if (self.excludeWordMatches.some(function(excludedMatch) { return excludedMatch.test(matchString); })) {
    return false;
  }

  // Finally confirm the title or url have words we care about
  if (self.includeMatchMatches.some(function(includedMatch) { return includedMatch.test(matchString); })) {
    return true;
  }
  return false;
}

/* -- Google Scraper */
var GoogleScraper = function (campaign) {
  var self = this;

  self.constructor.super_.call(self, campaign);
  self.engineName = 'google';
};

util.inherits(GoogleScraper, GenericSearchEngine);


GoogleScraper.prototype.beginSearch = function (browser) {
  var self = this;
  self.resultsCount = 0;
  self.emit('started');
  
  self.browser = browser;

  Seq()
    .seq(function(){
      self.buildSearchQuery(this);
    })
    .seq(function(searchTerm){
      self.searchTerm = searchTerm;
      this();
    })
    .seq(function(){
      self.browser.get('http://www.google.com', this); // start at google.com      
    })
    .seq(function(){
      self.browser.input({selector: 'input[name=q]', value: self.searchTerm}, this); //   
    })
    .seq(function(){
      self.browser.submit('input[name=q]', this);
    })
    .seq(function(){
      var that = this;
      self.browser.find('ol[id="rso"]', function(err){
        if(err){
          logger.warn('Failed to get any search results for ' + self.name + ' using ' + self.searchTerm);
          self.cleanup();
          // This is not an error, no results means our search terms are off.
        }
        else{
          self.handleResults();
        }
        that();
      });
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
}


GoogleScraper.prototype.getLinksFromSource = function (source, done) {
  var self = this
    , links = []
    , $ = cheerio.load(source)
    ;

  $('#search').find('#ires').find('#rso').children().each(function () {
    // Find out if this is a link we really want
    var title = $(this).find('a').text()
      , url = $(this).find('a').attr('href')
      , dateString = $(this).find('span.f').text().parameterize().replace('min', 'minute')
      , date = dateString.length > 8 ? Date.create(dateString) : null
      ;
    if (self.checkResultRelevancy(title, url, date))
      links.push(url);
    
  });
  done(null, links);
};

// clicks on the next page, waits for new results
GoogleScraper.prototype.nextPage = function () {
  var self = this;

  self.pageNumber += 1;
  if (self.pageNumber > self.maxPages) {
    logger.info('Reached maximum of %d pages', self.maxPages);
    return self.cleanup();
  }

  Seq()
    .seq(function(){
      self.browser.click('#pnnext', this);
    })
    .seq(function(){
      self.browser.find('ol[id="rso"]', function(err){
        if(err){
          // This is not an error, no results means our search terms are more than likely off.
          self.cleanup();
        }
        else{
          self.handleResults();
        }
      });
      this();
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
};

GoogleScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a#pnnext').length < 1) { return false; }
  return true;
};

/* -- Yahoo Scraper -- */
var YahooScraper = function (campaign) {
  var self = this;

  self.constructor.super_.call(self, campaign);

  self.engineName = 'yahoo';
};

util.inherits(YahooScraper, GenericSearchEngine);


YahooScraper.prototype.beginSearch = function (browser) {
  var self = this;
  self.emit('started');

  self.browser = browser;

  Seq()
    .seq(function(){
      self.buildSearchQuery(this);
    })
    .seq(function(searchTerm){
      self.searchTerm = searchTerm;
      this();
    })
    .seq(function(){
      self.browser.get('http://www.yahoo.com', this); // start at google.com      
    })
    .seq(function(){
      self.browser.input({selector: 'input[title="Search"]', value: self.searchTerm}, this); //finds <input name='q'>      
    })
    .seq(function(){
      self.browser.submit('input[title="Search"]', this);
    })
    .seq(function(){
      var that = this;
      self.browser.find('div#web', function(err){
        if(err){
          logger.warn('Failed to get any search results for ' + self.sourceName_ + ' using ' + self.searchTerm);
          self.cleanup();
        }
        else{
          self.handleResults();
        }
        that();
      });
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
};

YahooScraper.prototype.resolveLink = function(yahooLink, done){
  var self = this;
  Seq()
    .seq(function(){
      self.browser.get(yahooLink, this);
    })
    .seq(function(){
      self.browser.getCurrentUrl(this);
    })
    .seq(function(resolvedLink){
      done(null, resolvedLink);
    })
    .catch(function(err){
      done(err);
    })
    ;
}


YahooScraper.prototype.getLinksFromSource = function (source, done) {
  var self = this
    , links = []
    , $ = cheerio.load(source)
    ;

  $('div#web').find('ol').children('li').each(function () {
    var url = $(this).find('a').attr('href');
    var title = $(this).find('a').text().replace(/cached/i, '');
    if (self.checkResultRelevancy(title, url))
      links.push(url);
  });
  
  var resolvedLinks = [];
  var yahooSearchURL;

  Seq(links)
    .seq(function(){
      self.browser.getCurrentUrl(this);
    })
    .seq(function(yahooURL_){
      yahooSearchURL = yahooURL_;
      this();
    })
    .set(links)
    .seqEach(function(link){
      var that = this;
      self.resolveLink(link, function(err, resolvedLink){
        resolvedLinks.push(resolvedLink);
        that();
      });
    })
    .seq(function(){
      self.browser.get(yahooSearchURL, this);
    })
    .seq(function(){
      done(null, resolvedLinks);
    })
    .catch(function(err){
      logger.info('err ' + err);
      //done(err);
    })
    ;
};

// clicks on the next page, waits for new results
YahooScraper.prototype.nextPage = function () {
  var self = this;

  self.pageNumber += 1;
  if (self.pageNumber > self.maxPages) {
    logger.info('Reached maximum of %d pages', self.maxPages);
    self.cleanup();
    return;
  }

  Seq()
    .seq(function(){
      self.browser.click('a#pg-next', this);
    })
    .seq(function(){
      self.handleResults();
      this();
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
};

YahooScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a#pg-next').length < 1) { return false; }
  return true;
};

/* -- Bing Scraper -- */
var BingScraper = function (campaign) {
  var self = this;
  self.constructor.super_.call(self, campaign);

  self.engineName = 'bing';
};

util.inherits(BingScraper, GenericSearchEngine);


BingScraper.prototype.beginSearch = function (browser) {
  var self = this;
  self.emit('started');

  self.browser = browser;

  Seq()
    .seq(function(){
      self.buildSearchQuery(this);
    })
    .seq(function(searchTerm){
      self.searchTerm = searchTerm;
      this();
    })
    .seq(function(){
      self.browser.get('http://www.bing.com', this); // start at google.com      
    })
    .seq(function(){
      self.browser.input({selector: 'input[id=sb_form_q]', value: self.searchTerm}, this); //finds <input name='q'>      
    })
    .seq(function(){
      self.browser.submit('input#sb_form_go', this);
    })
    .seq(function(){
      self.browser.wait(3000, this);
    })
    .seq(function(){ 
      var that = this;
      self.browser.find('div[id="results"]', function(err){
        if(err){
          logger.warn('Failed to get any search results for ' + self.name + ' using ' + self.searchTerm);
          // This is not an error, no results means our search terms are off.
          self.cleanup();
        }
        else{
          self.handleResults();
        }
        that();
      });
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
}

BingScraper.prototype.getLinksFromSource = function (source, done) {
  var self = this
    , links = []
    , $ = cheerio.load(source)
    ;

  $('ul.sb_results').children('li.sa_wr').each(function () {
    var url = $(this).find('a').attr('href');
    var title = $(this).find('a').text().replace(/cached/i, '');
    
    if (self.checkResultRelevancy(title, url))
      links.push(url);
  });

  done(null, links);
};

// clicks on the next page, waits for new results
BingScraper.prototype.nextPage = function () {
  var self = this;
  self.pageNumber += 1;
  if (self.pageNumber > self.maxPages) {
    logger.info('Reached maximum of %d pages', self.maxPages);
    self.cleanup();
    return;
  }

  Seq()
    .seq(function(){
      self.browser.click('a.sb_pagN', this);
    })
    .seq(function(){
      self.handleResults();
      this();
    })
    .catch(function(err){
      self.emit('error', err);
      self.cleanup();
    })
    ;
};

BingScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a.sb_pagN').length < 1) { return false; }
  return true;
};

/* -- Filestube Scraper */
var FilestubeScraper = function (campaign) {
  var self = this;
  self.constructor.super_.call(self, campaign);
  self.engineName = 'filestube';
  self.apikey = '051b6ec16152e2a74da5032591e9cc84';
};

util.inherits(FilestubeScraper, GenericSearchEngine);

FilestubeScraper.prototype.beginSearch = function (browser) {
  var self = this;
  // we don't need no browser, we is restful like.
  browser.quit(); 
  self.resultsCount = 0;
  self.emit('started');

  // Search term is simply the campaign name with the '-' removed
  // Works best (tracks too specific), Maybe try just artist too ?
  var requestURI = "http://api.filestube.com/?key=" + 
                      self.apikey + 
                      '&phrase=' + URI.encode(self.campaign.name.remove('-'));

  request(requestURI, {}, self.extractLinks.bind(self));  
};

FilestubeScraper.prototype.extractLinks = function (err, resp, html) {
  var self = this;
  var links = [];
  var $ = cheerio.load(html);
  $('hits').each(function(){
      XRegExp.forEach(this.html(), urlmatch, function (match, i){
        links.push(match[0]);
      });
  });
  if(links.isEmpty()){
    logger.info('Nothing from Filestube');
  }
  else{
    logger.info('Found ' + links.length + ' links from Filestube.'); 
  }
  
  self.emitLinks(links);
  self.cleanup();
}

/* Scraper Interface */
var SearchEngine = module.exports = function () {
  this.sourceName_ = 'searchengine';
  this.init();
};
util.inherits(SearchEngine, Scraper);

SearchEngine.prototype.init = function () {
  var self = this;
};

//
// Overrides
//
SearchEngine.prototype.getName = function () {
  return "SearchEngine";
};

SearchEngine.prototype.getSourceName = function () {
  return this.sourceName_;
};

SearchEngine.prototype.start = function (campaign, job, browser) {
  var self = this;

  logger.info('started for %s', campaign.name);
  var scraperMap = {
    'google': { klass: GoogleScraper, sourceName: 'searchengine.google' },
    'yahoo': { klass: YahooScraper, sourceName: 'searchengine.bing' }, // Results come from bing
    'bing': { klass: BingScraper, sourceName: 'searchengine.bing' },
    'filestube': { klass: FilestubeScraper, sourceName: 'searchengine.filestube' }
  };

  logger.info('Loading search engine: %s', job.metadata.engine);
  self.scraper = new scraperMap[job.metadata.engine].klass(campaign);
  self.sourceName_ = scraperMap[job.metadata.engine].sourceName;

  self.scraper.on('finished', function onFinished() {
    self.emit('finished');
  });

  self.scraper.on('error', function onError(err) {
    self.emit('error', err);
    // do nuffink right now, handled elsewhere - where ? (cc)
  });

  self.scraper.on('found-link', function onFoundLink(link, points) {
    if(self.scraper.engineName === 'filestube')
      self.emit('infringement', link, points);
    else
      self.emit('metaInfringement', link, points);
  });

  self.scraper.beginSearch(browser);
  self.emit('started');
};

SearchEngine.prototype.stop = function () {
  var self = this;
  self.emit('finished');
};

SearchEngine.prototype.isAlive = function (cb) {
  var self = this;
  cb();
};

//
// Utils
//
function getValFromObj(key, obj) {
  return obj[key];
}

if (require.main === module) {
  var engine = new BingScraper({
    'metadata': {'lowPriorityWordList': ['blah', 'blah', 'meh']},
    'name': 'foo',
    'names': ['foo', 'meh', 'jsisdumb'],
    'type': 'movie'
  });

  engine.on('found-link', console.log);
  engine.on('error', console.log);

  engine.beginSearch();
}
