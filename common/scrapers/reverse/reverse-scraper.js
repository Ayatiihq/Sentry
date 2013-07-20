/*
 * reverse-scraper.js: uses verified endpoints to lookup related links
 *
 * (C) 2012 Ayatii Limited
 *
 * This scraper uses verified endpoints, such as torrents or known cyberlocker hosts, to find related
 * links in search engines.
 *
 */

var acquire = require('acquire')
  , blacklist = acquire('blacklist')
  , categories = acquire('states').infringements.category
  , cheerio = require('cheerio')
  , config = acquire('config')
  , database = acquire('database')
  , events = require('events')
  , logger = acquire('logger').forFile('reverse-scraper.js')
  , states = acquire('states').infringements.state
  , sugar = require('sugar')
  , util = require('util')
  , utilities = acquire('utilities')
  , webdriver = require('selenium-webdriver')
  ;

var Scraper = acquire('scraper')
  , Settings = acquire('settings')
  , Seq = require('seq')
  ;

var CAPABILITIES = { browserName: 'chrome', seleniumProtocol: 'WebDriver' }
  , MAX_SCRAPER_POINTS = 100
  ;

var ENGINES = {}; // This is the object engines register themselves in

var ReverseScraper = module.exports = function() {
  this.engineName_ = 'unknown';

  this.campaign_ = null;
  this.job_ = null;

  this.database_ = null;
  this.infringements_ = null;
  this.settings_ = null;

  this.remoteClient_ = null;
  this.idleTime_ = [5, 10];
  this.resultsCount_ = 0;
  this.maxPages_ = 25;
  this.pageNumber_ = 1;

  this.cachedCalls_ = [];

  this.init();
}

util.inherits(ReverseScraper, Scraper);

ReverseScraper.prototype.init = function() {
  var self = this;

  self.settings_ = new Settings('scraper.reverse');
  self.setupDatabase();
  self.setupBrowser();
}

ReverseScraper.prototype.setupDatabase = function() {
  var self = this;

  database.connectAndEnsureCollection('infringements', function(err, db, collection) {
    if (err)
      return logger.error('Unable to connect to database %s', err);

    self.database_ = db;
    self.infringements_ = collection;

    self.cachedCalls_.forEach(function(call) {
      call[0].apply(self, call[1]);
    });
    self.cachedCalls_ = [];
  });
}

ReverseScraper.prototype.setupBrowser = function() {
  var self = this;

  self.remoteClient_ = new webdriver.Builder()
                                    .usingServer(config.SELENIUM_HUB_ADDRESS)
                                    .withCapabilities(CAPABILITIES)
                                    .build();
  self.remoteClient_.manage()
                    .timeouts()
                    .implicitlyWait(10000);
}

ReverseScraper.prototype.run = function() {
  var self = this;

  if (!self.infringements_)
    return self.cachedCalls_.push([self.run, Object.values(arguments)]);

  Seq()
    .seq(function() {
      self.engineName_ = self.job_.metadata.engine;
      self.loadEngine(this);
    })
    .seq(function(engine) {
      self.engine_ = engine;
      self.getRunNumber(this);
    })
    .seq(function(runNumber) {
      self.engine_.getSearchTerm(runNumber, this);
    })
    .seq(function(searchTerm) {
      if (searchTerm == '') {
        // Probably no valid hits
        return this();
      }
      self.scrape(searchTerm, this);
    })
    .seq(function() {
      logger.info('Successfully completed scraper run');
      self.emit('finished')
    })
    .catch(function(err) {
      logger.warn('Unable to run scraper: %j %s', self.job_, err);
      logger.warn(err.stack);
      self.emit('error', err) ;
    })
    ;
}

ReverseScraper.prototype.loadEngine = function(done) {
  var self = this
    , engine = undefined
    , err = undefined
    ;

  var Klass = ENGINES[self.engineName_];

  try {
    if (!Klass)
       throw new Error(self.engineName_ +' is not a valid engine name');

    engine = new Klass(self.campaign_, self.infringements_);
  } catch (err) {
    err = err;
  }

  done(err, engine);
}

ReverseScraper.prototype.getRunNumber = function(done) {
  var self = this
    , key = util.format('%s.%s.runNumber', self.engineName_, self.campaign_.name)
    ;

  self.settings_.get(key, function(err, run) {
    if (err)
      done(err);

    run = run || 0;

    self.settings_.set(key, run + 1);

    done(null, run);
  });
}

ReverseScraper.prototype.scrape = function(searchTerm, done) {
  var self = this;

  self.scrapeDoneCallback_ = done;

  logger.info('Searching Google for %s', searchTerm);
  self.remoteClient_.get('http://www.google.com');
  self.remoteClient_.findElement(webdriver.By.css('input[name=q]'))
                    .sendKeys(searchTerm)
                    ;
  self.remoteClient_.findElement(webdriver.By.css('input[name=q]'))
                    .submit()
                    ;
  self.remoteClient_.findElement(webdriver.By.css('#search')).then(function(element) {
    if (!element) {
      logger.warn('No results returned for %s', searchTerm);
      return done();
    }

    self.scrapeSearchResults();
  });
}

ReverseScraper.prototype.scrapeSearchResults = function() {
  var self = this
    , source = ''
    ;

  self.remoteClient_.sleep(2500); // page render

  Seq()
    .seq(function() {
      self.remoteClient_.getPageSource().then(this.bind(null, null));
    })
    .seq(function(source_) {
      source = source_;
      self.scrapeLinksFromSource(source, this);
    })
    .seq(function(links) {
      self.emitLinks(links);
      if (self.checkHasNextPage(source)) {
        var randomTime = Number.random(self.idleTime_[0], self.idleTime_[1]);
        setTimeout(this, randomTime * 1000);
      } else {
        logger.info('Finished scraping');
        self.scrapeDoneCallback_(null);
      }
    })
    .seq(function() {
      self.pageNumber_ += 1;
      
      if (self.pageNumber_ > self.maxPages_) {
        logger.info('Reached maximum number of pages', self.maxPages_);
        return self.scrapeDoneCallback_();
      }

      logger.info('Going to next page');
      self.remoteClient_.findElement(webdriver.By.css('#pnnext')).click().then(this.bind(null, null));
    })
    .seq(function() {
      self.scrapeSearchResults();
    })
    .catch(function(err) {
      self.scrapeDoneCallback_(err);
    })
    ;
}

ReverseScraper.prototype.emitLinks = function(links) {
  var self = this
    , points = {
        engine: self.engineName_,
        score: MAX_SCRAPER_POINTS,
        source: 'reverse',
        message: ''
      }
    ;

  links.forEach(function(link){
    if (link[0] == '/')
      return;

    self.emit('metaInfringement', link, points);
  });
}

ReverseScraper.prototype.scrapeLinksFromSource = function(source, done) {
  var links = []
    , $ = cheerio.load(source)
    ;
  
  $('#search').find('#ires').find('#rso').children().each(function () {
    links.push($(this).find('a').attr('href'));
  });
  
  done(links ? null : new Error('No results for this search term'), links);
}

ReverseScraper.prototype.checkHasNextPage = function (source) {
  var $ = cheerio.load(source);
  if ($('a#pnnext').length < 1) { return false; }
  return true;
};

//
// Overrides
//
ReverseScraper.prototype.getName = function() {
  return 'ReverseScraper';
}

ReverseScraper.prototype.getSourceName = function() {
  return 'searchengine.google';
}

ReverseScraper.prototype.start = function(campaign, job) {
  var self = this;

  logger.info('Started for %j', job);

  self.campaign_ = campaign;
  self.job_ = job;

  self.run();

  self.emit('started');
}

ReverseScraper.prototype.stop = function() {
  var self = this;
  self.emit('finished');
}

ReverseScraper.prototype.isAlive = function(cb) {
  cb();
}


//
//
// BITTORRENT SCRAPER
//
//
var BittorrentScraper = ENGINES['bittorrent'] = function(campaign, infringements) {
  this.campaign_ = campaign;
  this.infringements_ = infringements;
}

BittorrentScraper.prototype.getSearchTerm = function(runNumber, done) {
  var self = this
    , query = {
        campaign: self.campaign_._id,
        scheme: 'torrent',
        'children.count': 0,
        state: {
          $in: [states.VERIFIED, states.SENT_NOTICE, states.TAKEN_DOWN]
        }
      }
    , project = { _id: 1, uri: 1 }
    , sort = { created: 1 }
    ;

  self.infringements_.find(query, project).sort(sort).toArray(function(err, torrents) {
    var searchTerm = '';

    if (err)
      return done(err);

    if (torrents.length) {
      var infringement = torrents[runNumber % torrents.length]
        , hash = infringement.uri.split('/')[2] // e.g. 'torrent://84bd0623b473cca375cf284d2eb4f630e154ac65/'
        ;

      searchTerm = hash;
    }

    done(null, searchTerm);
  });
}

//
//
// CYBERLOCKER SCRAPER
//
//
var CyberlockerScraper = ENGINES['cyberlocker'] = function(campaign, infringements) {
  this.campaign_ = campaign;
  this.infringements_ = infringements;
}

CyberlockerScraper.prototype.getSearchTerm = function(runNumber, done) {
  var self = this
    , query = {
        campaign: self.campaign_._id,
        category: categories.CYBERLOCKER,
        'children.count': 0,
        state: {
          $in: [states.VERIFIED, states.SENT_NOTICE, states.TAKEN_DOWN]
        }
      }
    , project = { _id: 1, uri: 1 }
    , sort = { created: 1 }
    ;

  self.infringements_.find(query, project).sort(sort).toArray(function(err, infringements) {
    var searchTerm = ''
      , cyberlockers = self.getDomainList(infringements)
      ;

    if (err)
      return done(err);

    if (cyberlockers.length) {
      var cyberlocker = cyberlockers[runNumber % cyberlockers.length];

      searchTerm = util.format('%s +\"%s\"', self.campaign_.name, cyberlocker);
    }

    done(null, searchTerm);
  });
}

CyberlockerScraper.prototype.getDomainList = function(infringements) {
  var self = this
    , domains = {}
    ;

  infringements.forEach(function(infringement) {
    var domain = utilities.getDomain(infringement.uri);
    if (domain)
      domains[domain] = true;
  });

  return Object.keys(domains);
}