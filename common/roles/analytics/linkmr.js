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
  , logger = acquire('logger').forFile('linkmr.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Settings = acquire('settings')
  , Seq = require('seq')
  ;

var LinkMR = module.exports;

//
// Clean up the db of the old campaign
//
LinkMR.preRun = function(db, collections, campaign, done) {
  var cols = [collections.linkStats];

  Seq(cols)
    .seqEach(function(collection) {
      collection.remove({ '_id.campaign': campaign._id }, done);
    })
    .seqEach(function(collection) {
      collection.remove({ '_id.client': campaign.client }, done);
    }) 
    .seq(function() {
      done();
    })
    .catch(function(err) {
      done(err);
    })
}

LinkMR.linkStats = function(db, collections, campaign, reallyDone) {

  var map = function() {
    var timestamp = 0;

    for (var i = 0; i < timeWindows.length; i++) {
      var window = timeWindows[i];

      if (!timestamp && this.created >= window) {
        timestamp = window;
        break;
      }
    } 

    var state = this.state;

    var value = {
      needsProcessing: state == -1 ? 1 : 0,
      unverified: state == 0 ? 1 : 0,
      verified: state == 1 ? 1 : 0,
      falsePositive: state == 2 ? 1 : 0,
      sentNotice: state == 3 ? 1 : 0,
      takenDown: state == 4 ? 1 : 0,
      needsScrape: state == 5 ? 1 : 0,
      deferred: state == 6 ? 1 : 0,
      unavailable: state == 7 ? 1 : 0,
      needsDownload: state ==  8 ? 1 : 0
    };

    emit({
           campaign: this.campaign,
           timestamp: timestamp
         },
         value);

     emit({
           campaign: this.campaign,
           timestamp: timestamp,
           category: this.category
         },
         value);
  }

  var reduce = function(key, values) {
    var finalValue = {
      needsProcessing: 0,
      unverified: 0,
      verified: 0,
      falsePositive: 0,
      sentNotice: 0,
      takenDown: 0,
      needsScrape: 0,
      deferred: 0,
      unavailable: 0,
      needsDownload: 0
    };

    values.forEach(function(value) {
      finalValue.needsProcessing += value.needsProcessing;
      finalValue.unverified += value.unverified;
      finalValue.verified += value.verified;
      finalValue.falsePositive += value.falsePositive;
      finalValue.sentNotice += value.sentNotice;
      finalValue.takenDown += value.takenDown;
      finalValue.needsScrape += value.needsScrape;
      finalValue.deferred += value.deferred;
      finalValue.unavailable += value.unavailable;
      finalValue.needsDownload += value.needsDownload;
    });

    return finalValue;
  }

  //
  // Pre-calculate the time windows for the last six hours, so infringements can
  // put themselves into the right window
  //
  var timeWindows = [];
  var time;

  // First this hour
  time = Date.utc.create().reset('minutes').getTime();
  timeWindows.push(time);

  // The rest i * -6
  for (var i = 1; i < 6; i++) {
    time = Date.utc.create((i * 12) + ' hours ago').reset('minutes').getTime();
    timeWindows.push(time);
  }

  var options = {
    out: {
      merge: 'linkStats'
    },
    query: {
      campaign: campaign._id,
      created: {
        $gte: timeWindows.last()
      }
    },
    scope: {
      timeWindows: timeWindows
    }
  };

  logger.info('LinkStats: Running mapreduce job for %s', campaign.name);
  var collection = collections['infringements'];
  collection.mapReduce(map, reduce, options, reallyDone);
}

LinkMR.linkStatsClient = function(db, collections, campaign, reallyDone) {

  var map = function() {
    var timestamp = 0;

    for (var i = 0; i < timeWindows.length; i++) {
      var window = timeWindows[i];

      if (!timestamp && this.created >= window) {
        timestamp = window;
        break;
      }
    } 

    var state = this.state;

    var value = {
      needsProcessing: state == -1 ? 1 : 0,
      unverified: state == 0 ? 1 : 0,
      verified: state == 1 ? 1 : 0,
      falsePositive: state == 2 ? 1 : 0,
      sentNotice: state == 3 ? 1 : 0,
      takenDown: state == 4 ? 1 : 0,
      needsScrape: state == 5 ? 1 : 0,
      deferred: state == 6 ? 1 : 0,
      unavailable: state == 7 ? 1 : 0,
      needsDownload: state ==  8 ? 1 : 0
    };

    emit({
           client: this.campaign.client,
           timestamp: timestamp
         },
         value);

     emit({
           client: this.campaign.client,
           timestamp: timestamp,
           category: this.category
         },
         value);
  }

  var reduce = function(key, values) {
    var finalValue = {
      needsProcessing: 0,
      unverified: 0,
      verified: 0,
      falsePositive: 0,
      sentNotice: 0,
      takenDown: 0,
      needsScrape: 0,
      deferred: 0,
      unavailable: 0,
      needsDownload: 0
    };

    values.forEach(function(value) {
      finalValue.needsProcessing += value.needsProcessing;
      finalValue.unverified += value.unverified;
      finalValue.verified += value.verified;
      finalValue.falsePositive += value.falsePositive;
      finalValue.sentNotice += value.sentNotice;
      finalValue.takenDown += value.takenDown;
      finalValue.needsScrape += value.needsScrape;
      finalValue.deferred += value.deferred;
      finalValue.unavailable += value.unavailable;
      finalValue.needsDownload += value.needsDownload;
    });

    return finalValue;
  }

  //
  // Pre-calculate the time windows for the last six hours, so infringements can
  // put themselves into the right window
  //
  var timeWindows = [];
  var time;

  // First this hour
  time = Date.utc.create().reset('minutes').getTime();
  timeWindows.push(time);

  // The rest i * -6
  for (var i = 1; i < 6; i++) {
    time = Date.utc.create((i * 6) + ' hours ago').reset('minutes').getTime();
    timeWindows.push(time);
  }

  var options = {
    out: {
      merge: 'linkStats'
    },
    query: {
      'campaign.client': campaign.client,
      created: {
        $gte: timeWindows.last()
      }
    },
    scope: {
      timeWindows: timeWindows
    }
  };

  logger.info('LinkStatsClient: Running mapreduce job for %s', campaign.name);
  var collection = collections['infringements'];
  collection.mapReduce(map, reduce, options, reallyDone);
}