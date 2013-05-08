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
    .seq(function() {
      done();
    })
    .catch(function(err) {
      done(err);
    })
}

LinkMR.linkStats = function(db, collections, campaign, reallyDone) {

  var map = function() {
    var hoursAgo = 0;

    for (var i = 0; i < timeWindows.length; i++) {
      var window = timeWindows[i];

      if (this.created >= window) {
        hoursAgo = i;
        break;
      }
    } 

    var state = this.state;

    var value = {
      needsProcessing: state == -1,
      unverified: state == 0,
      verified: state == 1,
      falsePositive: state == 2,
      sentNotice: state == 3,
      takenDown: state == 4,
      needsScrape: state == 5,
      deferred: state == 6,
      unavailable: state == 7,
      needsDownload: state == 8
    };

    emit({
           campaign: this.campaign,
           hoursAgo: hoursAgo
         },
         value);

     emit({
           campaign: this.campaign,
           hoursAgo: hoursAgo,
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

  // -1 hr
  time = Date.utc.create('1 hour ago').reset('minutes').getTime();
  timeWindows.push(time);

  // The rest
  for (var i = 2; i < 6; i++) {
    time = Date.utc.create(i + ' hours ago').reset('minutes').getTime();
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