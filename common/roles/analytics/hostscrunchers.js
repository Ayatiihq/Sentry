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

var Settings = acquire('settings')
  , Seq = require('seq')
  ;

var HostsCrunchers = module.exports;

//
// Build the interesting datasets so clients are faster
//

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
            .limit(10)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementHosts: Error compiling top ten infringement hosts: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenInfringementHosts' };
    var values = [];

    docs.forEach(function(doc) {
      var value = {};
      value[doc._id.host] = doc.value;
      values.push(value);
    });

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
            .limit(10)
            .toArray(function(err, docs) {

    if (err)
      return done('topTenInfringementCountries: Error compiling top ten infringement countries: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'topTenInfringementCountries' };
    var values = [];

    docs.forEach(function(doc) {
      var value = {};
      value[doc._id.countryCode] = doc.value;
      values.push(value);
    });

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

HostsCrunchers.infringementsCount = function(db, collections, campaign, done) {
  var collection = collections.infringements
    , analytics = collections.analytics
    ;

  logger.info('infringementsCount: Running job');

  collection.find({ campaign: campaign._id, state: { $in: [ 1, 3, 4] } })
            .count(function(err, count) {

    if (err)
      return done('infringementsCount: Error counting number of infringements: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'infringementsCount' };

    analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
  });
}

HostsCrunchers.falsePositiveCount = function(db, collections, campaign, done) {
  var collection = collections.infringements
    , analytics = collections.analytics
    ;

  logger.info('falsePositiveCount: Running job');

  collection.find({ 'campaign': campaign._id , state: states.infringements.state.FALSE_POSITIVE })
            .count(function(err, count) {

    if (err)
      return done('falsePositiveCount: Error counting number of false positives: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'falsePositiveCount' };

    analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
  });
}

HostsCrunchers.unverifiedCount = function(db, collections, campaign, done) {
  var collection = collections.infringements
    , analytics = collections.analytics
    ;

  logger.info('unverifiedCount: Running job');

  collection.find({ 'campaign': campaign._id , state: states.infringements.state.UNVERIFIED })
            .count(function(err, count) {

    if (err)
      return done('unverifiedCount: Error counting number of unverified: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'unverifiedCount' };

    analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
  });
}

HostsCrunchers.unverifiedEndpointCount = function(db, collections, campaign, done) {
  var collection = collections.infringements
    , analytics = collections.analytics
    ;

  logger.info('unverifiedEndpointCount: Running job');

  collection.find({ 'campaign': campaign._id , 'children.count': 0, state: states.infringements.state.UNVERIFIED })
            .count(function(err, count) {

    if (err)
      return done('unverifiedEndpointCount: Error counting number of unverified endpoints: ' + err);
    
    var key = { campaign: campaign._id, statistic: 'unverifiedEndpointCount' };

    analytics.update({ _id: key }, { _id: key, value: count }, { upsert: true }, done);
  });
}