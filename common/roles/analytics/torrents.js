  /*
 * torrents.js: the torrents analytics
 *
 * (C) 2012 Ayatii Limited
 *
 * Torrents runs analytics jobs for torrents
 *
 */

var acquire = require('acquire')
  , Campaigns = acquire('campaigns')
  , config = acquire('config')
  , events = require('events')
  , fmt = require('util').format
  , logger = acquire('logger').forFile('torrents.js')
  , redis = acquire('redis').createClient()
  , states = acquire('states')
  , util = require('util')
  ;

var Settings = acquire('settings')
  , Seq = require('seq')
  ;

var Torrents = module.exports;

//
// Utility methods
//
function setAndSend(campaign, key, value) {
  var key = fmt('%s:%s', campaign._id, key)
    , message = {}
    ;

  try {
    value = JSON.stringify(value);
  } catch(err) {
    logger.warn('Unable to publish %s (%s) to Redis: %s', key, value, error);
  }
  redis.set(key, value);

  message[key] = value;
  redis.publish('analytics', message);
}


Torrents.torrentsStats = function(db, collections, campaign, done) {
  var self = this
    , hadouken = collections['hadouken']
    , torrentStats = collections['torrentStats']
    , ips = collections['ips']
    ;

  logger.info('torrentsStats: Running job');

  hadouken.find({ '_id.campaign': campaign._id }).toArray(function(err, torrents) {
    if (err)
      return done(err);

    torrents.forEach(function(torrent) {
      
      var trackerStats = {};
      var shareStats = { downloadCount: 0, peerCount: 0, seederCount: 0, leecherCount: 0, lastChecked: 0 };
      var peerStats = {};
      var progressStats = {};

      torrent.state.forEach(function(state) {
        var timestamp = Object.keys(state)[0]
          , state = state[timestamp]
          ;

        state.trackerStats.forEach(function(tracker) {
          var key = tracker.announce + ' ' + torrent._id.torrent;
          var value = trackerStats[key];

          if (!value)
            value = { tracker: '', downloadCount: 0, peerCount: 0, seederCount: 0, leecherCount: 0, lastChecked: 0 };

          value.tracker = key;
          value.downloadCount = Math.max(value.downloadCount, tracker.downloadCount);
          value.peerCount = tracker.peerCount > 0 ? tracker.peerCount : 0;
          value.seederCount = tracker.seederCount > 0 ? tracker.seederCount : 0;
          value.leecherCount = tracker.leecherCount > 0 ? tracker.leecherCount : 0;
          value.lastChecked = timestamp * 1000; // Fucking python

          trackerStats[key] = value;
        });

        state.peers.forEach(function(peer) {
          var value = peerStats[peer.address];
          if (!value)
            value = { address: '', seenFirst: timestamp, seenLast: timestamp, progress: 0 };

          value.address = peer.address;
          value.seenFirst = Math.max(value.seenFirst, timestamp);
          value.seenLast = Math.min(value.seenLast, timestamp);
          value.progress = peer.progress;

          peerStats[peer.address] = value;
        });
      });

      Object.keys(trackerStats).forEach(function(key) {
        var tracker = trackerStats[key];
        shareStats.downloadCount += tracker.downloadCount;
        shareStats.peerCount += tracker.peerCount;
        shareStats.seederCount += tracker.seederCount;
        shareStats.leecherCount += tracker.leecherCount;
        shareStats.lastChecked = Math.max(shareStats.lastChecked, tracker.lastChecked);
      });

      Object.keys(peerStats).forEach(function(ip) {
        var peer = peerStats[ip];
        var progress = peer.progress.ceil(1);
        var pCount = progressStats[progress] || 0;
        progressStats[progress] = pCount + 1;
      });

      // Fix the values for the database
      // We want simple arrays whenever possible
      peerStats = Object.values(peerStats);
      trackerStats = Object.values(trackerStats);

      // Upload this shiznit
      var works = [
        { 'torrentPeerStats': peerStats },
        { 'torrentTrackerStats': trackerStats },
        { 'torrentProgressStats': progressStats },
        { 'torrentShareStats': shareStats }
      ];

      Seq(works)
        .seqEach(function(work) {
          var stat = Object.keys(work)[0]
            , value = work[stat]
            , key = { campaign: campaign._id, statistic: stat }
            ;

          torrentStats.update({ _id: key }, { _id: key, value: value }, { upsert: true }, this);
          setAndSend(campaign, stat, value);
        })
        .set(peerStats)
        .seqEach(function(peer) {
          ips.update({ _id: peer.address }, { $addToSet: { campaigns: campaign._id } }, { upsert: true }, this);
        })
        .seq(function() {
          done();
        })
        .catch(function(err) {
          done(err);
        })
        ;
    });
  });
}
