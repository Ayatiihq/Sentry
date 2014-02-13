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
  , utilities = acquire('utilities')
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

    var trackerStats = {};
    var shareStats = { downloadCount: 0, peerCount: 0, seederCount: 0, leecherCount: 0, lastChecked: 0 };
    var peerStats = {};
    var progressStats = {};
    var peerDownloadCounts = 0;
    
    torrents.forEach(function(torrent) {
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

      if (progress == 1)
        peerDownloadCounts += 1;
    });

    // Make sure we have the most relevant stats
    // This is because we can be finding more info off DHT
    // than what trackers are reporting. At least when the torrents
    // are young, we'll get DHT stats that are higher
    shareStats.downloadCount = Math.max(shareStats.downloadCount, peerDownloadCounts)


    // Fix the values for the database
    // We want simple arrays whenever possible
    peerStats = Object.values(peerStats);
    trackerStats = Object.values(trackerStats);

    // Upload this shiznit
    var works = [
      { 'torrentPeerStats': peerStats },
      { 'torrentTrackerStats': trackerStats },
      { 'torrentProgressStats': progressStats },
      { 'torrentShareStats': shareStats },
      { 'torrentCount': torrents.length }
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
}

Torrents.ipInfo = function(db, collections, campaign, done) {
  var self = this
    , ips = collections['ips']
    , query = {
        campaigns: campaign._id,
        $or: [
          {
            ipInfo: { $exists: false }
          },
          {
            'ipInfo.created': { $lt: Date.create('1 month ago').getTime() }
          }
        ]
      }
    , project = {
        _id: 1
      }
    ;

  logger.info('ipInfo: Running job');

  ips.find(query).toArray(function(err, docs) {
    if (err)
      return logger.warn('Unable to get list of ips to tackle for %s: %s', campaign._id, err); 

    Seq(docs)
      .seqEach(function(ip) {
        var that = this
          , query = 'http://api.ipaddresslabs.com/iplocation/v1.7/locateip?key=SAK28R284C8F452PA27Z&ip=%s&format=json&compact=Y'
          ;

        url = fmt(query, ip._id);
        utilities.request(url, {}, function(err, res, body) {
          if (err) {
            logger.warn('Unable to get info for %s: %s', ip._id, JSON.stringify(err));
            return that();
          }

          try {
            body = JSON.parse(body);
          } catch (err) {
            logger.warn('Unable to parse info response of %s: %s (%s)', ip._id, err, body);
            return that();
          }

          var info = body['geolocation_data'];
          if (!info) {
            logger.warn('Unable to get info for %s: %s', ip._id, body);
            return that();
          }

          info.created = Date.now();

          ips.update({ _id: ip._id }, { $set: { ipInfo: info } }, that);
        });
      })
      .seq(function() {
        done();
      })
      .catch(function(err) {
        console.log('Unable to get info of ips for %s: %s', campaign._id, err);
        done(err);
      })
      ;
  });
}

Torrents.ipStats = function(db, collections, campaign, done) {
  var self = this
    , ips = collections['ips']
    , torrentStats = collections['torrentStats']
    ;

  logger.info('ipStats: Running job');

  ips.find({ campaigns: campaign._id, ipInfo: { $exists: true } }, { ipInfo: 1 }).toArray(function(err, docs) {
    if (err)
      return logger.warn('Unable to get list of ips to stat for %s: %s', campaign._id, err); 

    var ipCountries = {}
      , ipCities = {}
      , ipISPs = {}
      ;

    docs.forEach(function(ip) {
      var address = ip._id
        , country = ip.ipInfo.country_code_iso3166alpha3
        , city = ip.ipInfo.city
        , isp = ip.ipInfo.organization
        , value = {}
        ;

      value = ipCountries[country] || { country: '', count: 0 };
      value.country = country;
      value.count += 1;
      ipCountries[country] = value;

      value = ipCities[country + city] || { country: '', city: '', count: 0 };
      value.country = country;
      value.city = city;
      value.latitude = ip.ipInfo.latitude;
      value.longitude = ip.ipInfo.longitude;
      value.count += 1;
      ipCities[country + city] = value;

      value = ipISPs[isp + country] || { country: '', isp: '', count: 0 };
      value.country = country;
      value.isp = isp;
      value.count += 1;
      ipISPs[isp + country] = value;
    });

    function sort(a, b) {
      return b.count - a.count;
    }

    ipCountries = Object.values(ipCountries).sort(sort);
    ipCities = Object.values(ipCities).sort(sort);
    ipISPs = Object.values(ipISPs).sort(sort);

    // Upload this shiznit
    var works = [
      { 'torrentPeerCountries': ipCountries },
      { 'torrentPeerCities': ipCities },
      { 'torrentPeerISPs': ipISPs },
      { 'torrentISPCount': ipISPs.length }
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
      .seq(function() {
        done();
      })
      .catch(function(err) {
        done(err);
      })
      ;
  });
}