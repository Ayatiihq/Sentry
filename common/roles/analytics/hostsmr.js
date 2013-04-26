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
  , logger = acquire('logger').forFile('hostsmr.js')
  , states = acquire('states')
  , util = require('util')
  ;

var Settings = acquire('settings')
  , Seq = require('seq')
  ;

var HostsMR = module.exports;

HostsMR.hostStats = function(db, collections, campaign, done) {
    
    var map = function() {
      var key = {
        campaign: this.campaign,
        host: 'unknown',
        type: 'hostStats'
      };

      var value = {
        count: 1,
        first: this.created,
        last: this.created,
        parents: this.parents.count,
        children: this.children.count
      };

      // Try and figure out the host
      if (this.uri.indexOf('/') == 0) {
        print('Error: URI starts with \'/\': ' + this.uri);
      
      } else if (this.meta) {
        key.host = this.source;
      
      } else if (this.scheme == 'torrent') {
        key.host = 'torrent';
      
      } else if (this.scheme == 'magnet') {
        key.host = 'magnet'
      
      } else {
        var tokens = this.uri.split('/');
        if (tokens[1] == '') { // normal URI
          key.host = tokens[2];
        } else {
          key.host = tokens[0];
        }

        if (key.host.match(new RegExp(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i))) {
          // do nothing;

        } else if (key.host.match(new RegExp(/\.[a-z]{2,3}\.[a-z]{2}$/i))) {
          // MATCHED '.??.??' OR '.???.??' FROM END - e.g. '.CO.UK', '.COM.AU'
          var tokens = key.host.split('.');
          var size = tokens.length;
          key.host = tokens[size - 3] +  '.' + tokens[size-2] + '.' + tokens[size-1];
       
        } else if (key.host.match(new RegExp(/\.[a-z]{2,4}$/i))) {
          // MATCHED '.??' or '.???' or '.????' FROM END - e.g. '.US', '.COM', '.INFO'
          var tokens = key.host.split('.');
          var size = tokens.length;
          key.host = tokens[size-2] + '.' + tokens[size-1];
        }
      }

      emit(key, value);

      // Emit one for the state
      key.state = this.state;
      emit(key, value);
    }

    var reduce = function(key, values) {
      var finalValue = { 
        count: 0,
        first: values[0].first, // Don't get Math confused.
        last: 0,
        parents: 0,
        children: 0
     };

      values.forEach(function(value) {
        finalValue.count += value.count;
        finalValue.first = Math.min(finalValue.first, value.first);
        finalValue.last = Math.max(finalValue.last, value.last);
        finalValue.parents += value.parents;
        finalValue.children += value.children;
      });

      return finalValue;
    }

    var options = {
      out: { merge: 'analytics' },
      query: {
        campaign: campaign._id
      }
    };

    logger.info('Running enumerateHosts MapReduce Job for %s', campaign.name);
    var collection = collections['infringements'];
    collection.mapReduce(map, reduce, options, done);
}

