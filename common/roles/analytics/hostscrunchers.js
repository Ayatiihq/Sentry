  /*
 * analytics.js: the analytics
 *
 * (C) 2012 Ayatii Limited
 *
 * Analytics runs analytics jobs.
 *
 */

var acquire = require('acquire')
  , config = acquire('config')
  , events = require('events')
  , logger = acquire('logger').forFile('hostscrunchers.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Category = states.infringements.category
  , Cyberlockers = acquire('cyberlockers')
  , Settings = acquire('settings')
  , Seq = require('seq')
  , State = states.infringements.state
  ;

var HostsCrunchers = module.exports;

var stateData = [
    { name: 'nNeedsProcessing', state: State.NEEDS_PROCESSING }
  , { name: 'nUnverified', state: State.UNVERIFIED }
  , { name: 'nVerified', state: State.VERIFIED }
  , { name: 'nFalsePositive', state: State.FALSE_POSITIVE }
  , { name: 'nSentNotice', state: State.SENT_NOTICE }
  , { name: 'nTakenDown', state: State.TAKEN_DOWN }
  , { name: 'nNeedsScrape', state: State.NEEDS_SCRAPE }
  , { name: 'nDeferred', state: State.DEFERRED }
  , { name: 'nUnavailable', state: State.UNAVAILABLE }
  , { name: 'nNeedsDownload', state: State.NEEDS_DOWNLOAD }
];

var categoryData = [
    { name: 'nWebsites', category: Category.WEBSITE }
  , { name: 'nSearchResults', category: Category.SEARCH_RESULT }
  , { name: 'nCyberlockers', category: Category.CYBERLOCKER }
  , { name: 'nFiles', category: Category.FILE }
  , { name: 'nTorrents', category: Category.TORRENT }
  , { name: 'nSocial', category: Category.SOCIAL}
];

//
// Build the interesting datasets so clients are faster
//

HostsCrunchers.nTotalHosts = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('nTotalHosts: Running job');
  
  collection.find({ '_id.campaign': campaign._id, '_id.state': { $exists: false }})
            .count(function(err, count) {

    if (err)
      return done('nTotalHosts: Error compiling host count: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'nTotalHosts' };
    analytics.update({ _id: key }, { _id: key, value: count ? count : 0 }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenLinkHosts = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenLinkHosts: Running job');

  // Compile the top ten hosts carrying LINKS
  collection.find({ '_id.campaign': campaign._id, '_id.state': { $exists: false }})
            .sort({ 'value.count': -1 })
            .limit(10)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenLinkHosts: Error compiling top ten link hosts: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenLinkHosts' };
    var values = [];

    docs.forEach(function(doc) {
      var value = {};
      value[doc._id.host] = doc.value;
      values.push(value);
    });

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  }); 
}

HostsCrunchers.topTenInfringementHosts = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenInfringementHosts: Running job');

  // Compile the top ten hosts carrying INFRINGEMENTS
  collection.find({ '_id.campaign': campaign._id, '_id.state': { $in: [ 1, 3, 4] }})
            .sort({ 'value.count': -1 })
            .limit(25)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementHosts: Error compiling top ten infringement hosts: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenInfringementHosts' };
    var map = {};
    var values = [];

    docs.forEach(function(doc) {
      var value = {};

      if (map[doc._id.host])
        map[doc._id.host].count += doc.value.count;
      else
        map[doc._id.host] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenInfringementCyberlockers = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenInfringementCyberlockers: Running job');

  // Compile the top ten hosts carrying INFRINGEMENTS
  collection.find({ '_id.campaign': campaign._id, '_id.state': { $in: [ 1, 3, 4] }})
            .sort({ 'value.count': -1 })
            .limit(150)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementCyberlockers: Error compiling top ten infringement cyberlockers: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenInfringementCyberlockers' };
    var map = {};
    var values = [];

    docs.forEach(function(doc) {
      var value = {};

      if (Cyberlockers.indexOf(doc._id.host) < 0)
        return;

      if (map[doc._id.host])
        map[doc._id.host].count += doc.value.count;
      else
        map[doc._id.host] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenLinkCyberlockers = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenLinkCyberlockers: Running job');

  // Compile the top ten hosts carrying INFRINGEMENTS
  collection.find({ '_id.campaign': campaign._id })
            .sort({ 'value.count': -1 })
            .limit(150)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenLinkCyberlockers: Error compiling top ten infringement cyberlockers: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenLinkCyberlockers' };
    var map = {};
    var values = [];

    docs.forEach(function(doc) {
      var value = {};

      if (Cyberlockers.indexOf(doc._id.host) < 0)
        return;

      if (map[doc._id.host])
        map[doc._id.host].count += doc.value.count;
      else
        map[doc._id.host] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenLinkCountries = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('topTenLinkCountries: Running job');
  
  collection.find({ '_id.campaign': campaign._id, '_id.regionName': { $exists: false }, '_id.cityName': { $exists: false }, '_id.state': { $exists: false } })
            .sort({ 'value.count': -1 })
            .limit(10)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenLinkCountries: Error compiling top ten link countries: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenLinkCountries' };
    var values = [];

    docs.forEach(function(doc) {
      var value = {};
      value[doc._id.countryCode] = doc.value;
      values.push(value);
    });

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenInfringementCountries = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('topTenInfringementCountries: Running job');

  collection.find({ '_id.campaign': campaign._id, '_id.regionName': { $exists: false }, '_id.cityName': { $exists: false }, '_id.state': { $in: [ 1, 3, 4] } })
            .sort({ 'value.count': -1 })
            .limit(25)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementCountries: Error compiling top ten infringement countries: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenInfringementCountries' };
    var values = [];
    var map = {};

    docs.forEach(function(doc) {
      var value = {};

      if (map[doc._id.countryCode])
        map[doc._id.countryCode].count += doc.value.count;
      else
        map[doc._id.countryCode] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.linksCount = function(db, collections, campaign, done) {
  var collection = collections.infringements
    , analytics = collections.analytics
    ;

  logger.info('linksCount: Running job');

  collection.find({ 'campaign': campaign._id })
            .count(function(err, count) {

    if (err)
      return done('linksCount: Error counting number of links: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'linksCount' };

    analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
  });
}

HostsCrunchers.nTotalCountries = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('nTotalCountries: Running job');
  
  collection.find({ '_id.campaign': campaign._id, '_id.regionName': { $exists: false }, '_id.cityName': { $exists: false }, '_id.state': { $exists: false } })
            .count(function(err, count) {

    if (err)
      return done('nTotalCountries: Error compiling country count: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'nTotalCountries' };
    analytics.update({ _id: key }, { _id: key, value: count ? count : 0 }, { upsert: true }, done);
  });
}

stateData.forEach(function(data) {
  var name = data.name;
  var state = data.state;

  HostsCrunchers[name] = function(db, collections, campaign, done) {
    var collection = collections.infringements
      , analytics = collections.analytics
      ;

    logger.info(name + ': Running job');
    collection.find({ campaign: campaign._id, state: state })
              .count(function(err, count) {
      if (err)
        return done(name + ': Error counting number of links with state ' + state + ': ' + err);

      var key = { campaign: campaign._id, statistic: name };
      analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
    });
  }
});

categoryData.forEach(function(data) {
  var name = data.name;
  var category = data.category;

  HostsCrunchers[name] = function(db, collections, campaign, done) {
    var collection = collections.infringements
      , analytics = collections.analytics
      ;

    logger.info(name + ': Running job');
    collection.find({ campaign: campaign._id, category: category, state: { $in: [1, 3, 4]} })
              .count(function(err, count) {
      if (err)
        return done(name + ': Error counting number of links with category ' + category + ': ' + err);

      var key = { campaign: campaign._id, statistic: name };
      analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
    });
  }
});


//
// Client
//

HostsCrunchers.nTotalHostsClient = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('nTotalHostsClient: Running job');
  
  collection.find({ '_id.client': campaign.client, '_id.state': { $exists: false }})
            .count(function(err, count) {

    if (err)
      return done('nTotalHostsClient: Error compiling host count: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'nTotalHosts' };
    analytics.update({ _id: key }, { _id: key, value: count ? count : 0 }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenLinkHostsClient = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenLinkHostsClient: Running job');

  // Compile the top ten hosts carrying LINKS
  collection.find({ '_id.client': campaign.client, '_id.state': { $exists: false }})
            .sort({ 'value.count': -1 })
            .limit(10)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenLinkHostsClient: Error compiling top ten link hosts: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'topTenLinkHosts' };
    var values = [];

    docs.forEach(function(doc) {
      var value = {};
      value[doc._id.host] = doc.value;
      values.push(value);
    });

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  }); 
}

HostsCrunchers.topTenInfringementHostsClient = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenInfringementHostsClient: Running job');

  // Compile the top ten hosts carrying INFRINGEMENTS
  collection.find({ '_id.client': campaign.client, '_id.state': { $in: [ 1, 3, 4] }})
            .sort({ 'value.count': -1 })
            .limit(25)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementHostsClient: Error compiling top ten infringement hosts: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'topTenInfringementHosts' };
    var map = {};
    var values = [];

    docs.forEach(function(doc) {
      var value = {};

      if (map[doc._id.host])
        map[doc._id.host].count += doc.value.count;
      else
        map[doc._id.host] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}


HostsCrunchers.topTenInfringementCyberlockersClient = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenInfringementCyberlockersClient: Running job');

  // Compile the top ten hosts carrying INFRINGEMENTS
  collection.find({ '_id.client': campaign.client, '_id.state': { $in: [ 1, 3, 4] }})
            .sort({ 'value.count': -1 })
            .limit(150)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementCyberlockersClient: Error compiling top ten infringement hosts: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'topTenInfringementCyberlockers' };
    var map = {};
    var values = [];

    docs.forEach(function(doc) {
      var value = {};

      if (Cyberlockers.indexOf(doc._id.host) < 0)
        return;

      if (map[doc._id.host])
        map[doc._id.host].count += doc.value.count;
      else
        map[doc._id.host] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenLinkCyberlockersClient = function(db, collections, campaign, done) {
  var collection = collections.hostBasicStats
    , analytics = collections.analytics
    ;

  logger.info('topTenLinkCyberlockersClient: Running job');
  
  var cyberlockers = new Cyberlockers();

  // Compile the top ten hosts carrying INFRINGEMENTS
  collection.find({ '_id.client': campaign.client })
            .sort({ 'value.count': -1 })
            .limit(150)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenLinkCyberlockersClient: Error compiling top ten infringement hosts: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'topTenLinkCyberlockers' };
    var map = {};
    var values = [];

    cyberlockers.knownDomains(function(err, knownDomains){
      if (err)
        return done('topTenLinkCyberlockersClient: Error compiling top ten infringement hosts: ' + err);
      docs.forEach(function(doc) {
        var value = {};

        if (Cyberlockers.indexOf(doc._id.host) < 0)
          return;

        if (map[doc._id.host])
          map[doc._id.host].count += doc.value.count;
        else
          map[doc._id.host] = doc.value;
      });

      Object.keys(map, function(key) {
        var obj = {};
        obj[key] = map[key];
        values.push(obj);
      });

      values.sortBy(function(n) {
        return n.count * -1;
      });

      values = values.to(10);

      analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
    });      
  });
}

HostsCrunchers.nTotalCountriesClient = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('nTotalCountries: Running job');
  
  collection.find({ '_id.client': campaign.client, '_id.regionName': { $exists: false }, '_id.cityName': { $exists: false }, '_id.state': { $exists: false } })
            .count(function(err, count) {

    if (err)
      return done('nTotalCountries: Error compiling top ten link countries: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'nTotalCountries' };
    analytics.update({ _id: key }, { _id: key, value: count ? count : 0 }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenLinkCountriesClient = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('topTenLinkCountriesClient: Running job');
  
  collection.find({ '_id.client': campaign.client, '_id.regionName': { $exists: false }, '_id.cityName': { $exists: false }, '_id.state': { $exists: false } })
            .sort({ 'value.count': -1 })
            .limit(10)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenLinkCountriesClient: Error compiling country count: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'topTenLinkCountries' };
    var values = [];

    docs.forEach(function(doc) {
      var value = {};
      value[doc._id.countryCode] = doc.value;
      values.push(value);
    });

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.topTenInfringementCountriesClient = function(db, collections, campaign, done) {
  var collection = collections.hostLocationStats
    , analytics = collections.analytics
    ;

  logger.info('topTenInfringementCountriesClient: Running job');

  collection.find({ '_id.client': campaign.client, '_id.regionName': { $exists: false }, '_id.cityName': { $exists: false }, '_id.state': { $in: [ 1, 3, 4] } })
            .sort({ 'value.count': -1 })
            .limit(25)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementCountriesClient: Error compiling top ten infringement countries: ' + err);
    
    var key = { 'client': campaign.client, statistic: 'topTenInfringementCountries' };
    var values = [];
    var map = {};

    docs.forEach(function(doc) {
      var value = {};

      if (map[doc._id.countryCode])
        map[doc._id.countryCode].count += doc.value.count;
      else
        map[doc._id.countryCode] = doc.value;
    });

    Object.keys(map, function(key) {
      var obj = {};
      obj[key] = map[key];
      values.push(obj);
    });

    values.sortBy(function(n) {
      return n.count * -1;
    });

    values = values.to(10);

    analytics.update({ _id: key }, { _id: key, value: values }, { upsert: true }, done);
  });
}

HostsCrunchers.linksCountClient = function(db, collections, campaign, done) {
  var collection = collections.infringements
    , analytics = collections.analytics
    ;

  logger.info('linksCountClient: Running job');

  collection.find({ 'campaign.client': campaign.client })
            .count(function(err, count) {

    if (err)
      return done('linksCountClient: Error counting number of links: ' + err);
    
    var key = { client: campaign.client, statistic: 'linksCount' };

    analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
  });
}

stateData.forEach(function(data) {
  var method = data.name + 'Client'
  var name = data.name;
  var state = data.state;

  HostsCrunchers[method] = function(db, collections, campaign, done) {
    var collection = collections.infringements
      , analytics = collections.analytics
      ;

    logger.info(method + ': Running job');
    collection.find({ 'campaign.client': campaign.client, state: state })
              .count(function(err, count) {
      if (err)
        return done(method + ': Error counting number of links with state ' + state + ': ' + err);

      var key = { client: campaign.client, statistic: name };
      analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
    });
  }
});

categoryData.forEach(function(data) {
  var method = data.name + 'Client'
  var name = data.name;
  var category = data.category;

  HostsCrunchers[method] = function(db, collections, campaign, done) {
    var collection = collections.infringements
      , analytics = collections.analytics
      ;

    logger.info(method + ': Running job');
    collection.find({ 'campaign.client': campaign.client, category: category, state: { $in: [1, 3, 4]} })
              .count(function(err, count) {
      if (err)
        return done(method + ': Error counting number of links with category ' + category + ': ' + err);

      var key = { client: campaign.client, statistic: name };
      analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
    });
  }
});