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
  , dns = require('dns')
  , events = require('events')
  , logger = acquire('logger').forFile('hostsinfo.js')
  , request = require('request')
  , states = acquire('states')
  , util = require('util')
  ;

var Settings = acquire('settings')
  , Seq = require('seq')
  ;

var IPINFODB_QUERY_TEMPLATE = 'http://api.ipinfodb.com/v3/ip-city/?key=eb0c816b0e98c3a1426cb2a3002ebf2146cf419cf7949d364eabc3b90e1c5504&ip=%s&format=json'

var HostsMR = module.exports;

HostsMR.serverInfo = function(db, collections, campaign, done) {
  var collection = collections.hosts
    , query = {
        $or: [
          {
            serverInfo: {
              $exists: false
            }
          },
          {
            'serverInfo.created': {
              $lt: Date.create('1 month ago').getTime()
            }
          }
        ]
      }
    ;

  collection.find(query).toArray(function(err, hosts) {
    if (err)
      return done(err);

    Seq(hosts)
      .seqEach(function(host) {
        var that = this;

        getHostServerInfo(host, function(err, serverInfo) {
          if (err || !serverInfo) {
            logger.warn('Unable to get serverInfo for %s: %s', host._id, err ? err : 'serverInfo invalid');
            that();
          } else {
            serverInfo.created = Date.now();
            collection.update({ _id: host._id }, { $set: { serverInfo: serverInfo } }, function(err) {
              if (err)
                logger.warn('Unable to get serverInfo for %s: %s', host._id, err ? err : 'unknown');
              that();
            });
          }
        });
      })
      .seq(function(){
        logger.info('Finished finding host server information');
        done();
      })
      .catch(function(err) {
        done(err);        
      })
      ;
  });
}

function getHostServerInfo(host, done) {
  var hostname = host._id;

  Seq()
    .seq(function() {
      dns.lookup(host._id, this);
    })
    .seq(function(ip) {
      logger.info('Getting server information of %s', ip);
      var uri = util.format(IPINFODB_QUERY_TEMPLATE, ip);
      request(uri, this);
    })
    .seq(function(res, body) {
      var err = null
        , serverInfo = null
        ;

      try {
        var reply = JSON.parse(body);
        serverInfo = Object.reject(reply, ['statusCode', 'statusMessage']);
      } catch (error) {
        err = error;
      }

      // Stagger the requests as per docs on www.ipinfodb.com
      setTimeout(done.bind(null, err, serverInfo), 1000 * 3);
    })
    .catch(function(err) {
      done(err);
    })
    ;
}

HostsMR.websiteInfo = function(db, collections, campaign, done) {
  done();
}
