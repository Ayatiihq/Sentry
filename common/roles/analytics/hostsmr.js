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

//
// Clean up the db of the old campaign
//
HostsMR.preRun = function(db, collections, campaign, done) {
  var cols = [collections.hostBasicStats, collections.hostLocationStats];

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

HostsMR.hostLocationStats = function(db, collections, campaign, reallyDone) {
  function runMapReduceJob(hosts) {

    var map = function() {
      var host = null;

      // Try and figure out the host
      if (this.uri.indexOf('/') == 0) {
        print('Error: URI starts with \'/\': ' + this.uri);
      
      } else if (this.meta) {
        host = this.source;

      } else if (this.scheme == 'torrent') {
     
      } else if (this.scheme == 'magnet') {
      
      } else {
        var tokens = this.uri.split('/');
        if (tokens[1] == '') { // normal URI
          host = tokens[2];
        } else {
          host = tokens[0];
        }

        if (host.match(new RegExp(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i))) {
          // do nothing;

        } else if (host.match(new RegExp(/\.[a-z]{2,3}\.[a-z]{2}$/i))) {
          // MATCHED '.??.??' OR '.???.??' FROM END - e.g. '.CO.UK', '.COM.AU'
          var tokens = host.split('.');
          var size = tokens.length;
          host = tokens[size - 3] +  '.' + tokens[size-2] + '.' + tokens[size-1];
       
        } else if (host.match(new RegExp(/\.[a-z]{2,4}$/i))) {
          // MATCHED '.??' or '.???' or '.????' FROM END - e.g. '.US', '.COM', '.INFO'
          var tokens = host.split('.');
          var size = tokens.length;
          host = tokens[size-2] + '.' + tokens[size-1];
        }
      }

      if (!host)
        return;

      var value = {
        count: 1,
        first: this.created,
        last: this.created,
        parents: this.parents.count,
        children: this.children.count
      };

      serverInfo = hosts[host];
      if (!serverInfo)
        return;

      if (serverInfo.countryCode) {
        emit({ 
                campaign: this.campaign,
                countryCode: serverInfo.countryCode
             },
             value);

        emit({ 
                campaign: this.campaign,
                countryCode: serverInfo.countryCode,
                state: this.state
             },
             value);
      }

      if (serverInfo.regionName) {
        emit({
                campaign: this.campaign,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName
              },
              value);

        emit({
                campaign: this.campaign,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName,
                state: this.state
              },
              value);
      }

      if (serverInfo.cityName) {
        emit({
                campaign: this.campaign,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName,
                cityName: serverInfo.cityName
              },
              value);
        emit({
                campaign: this.campaign,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName,
                cityName: serverInfo.cityName,
                state: this.state
              },
              value);
      }
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
      out: {
        merge: 'hostLocationStats'
      },
      query: {
        campaign: campaign._id
      },
      scope: {
        hosts: hosts
      }
    };

    logger.info('hostLocationStats: Running mapreduce job for %s', campaign.name);
    var collection = collections['infringements'];
    collection.mapReduce(map, reduce, options, reallyDone);
  }

  function marshalHosts(done, err, docs) {
    var hosts = {};

    logger.info('hostLocationStats: Marshalling hosts')

    if (err)
      return reallyDone(err);

    docs.forEach(function(host) {
      hosts[host._id] = host.serverInfo;
    });

    done(hosts);
  }

  function getHostInfo(done) {
    logger.info('hostLocationStats: Getting hosts')
    var collection = collections.hosts;
    collection.find({ serverInfo: { $exists: true }},
                    {
                      'serverInfo.countryCode': 1,
                      'serverInfo.regionName': 1,
                      'serverInfo.cityName': 1
                    })
              .toArray(marshalHosts.bind(null, done));
  }

  logger.info('hostLocationStats: Constructing mapreduce job for %s', campaign.name);
  getHostInfo(runMapReduceJob);
}

HostsMR.hostBasicStats = function(db, collections, campaign, done) {
    
    var map = function() {
      var key = {
        campaign: this.campaign,
        host: 'unknown'
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
        //key.host = 'torrent';
      
      } else if (this.scheme == 'magnet') {
        //key.host = 'magnet'
      
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

      if (!key.host)
        return;

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
      out: {
        merge: 'hostBasicStats'
      },
      query: {
        campaign: campaign._id
      }
    };

    logger.info('hostBasicStats: Running mapreduce job for %s', campaign.name);
    var collection = collections['infringements'];
    collection.mapReduce(map, reduce, options, done);
}

HostsMR.hostClientLocationStats = function(db, collections, campaign, reallyDone) {
  function runMapReduceJob(hosts) {

    var map = function() {
      var host = null;

      // Try and figure out the host
      if (this.uri.indexOf('/') == 0) {
        print('Error: URI starts with \'/\': ' + this.uri);
      
      } else if (this.meta) {
        host = this.source;

      } else if (this.scheme == 'torrent') {
     
      } else if (this.scheme == 'magnet') {
      
      } else {
        var tokens = this.uri.split('/');
        if (tokens[1] == '') { // normal URI
          host = tokens[2];
        } else {
          host = tokens[0];
        }

        if (host.match(new RegExp(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i))) {
          // do nothing;

        } else if (host.match(new RegExp(/\.[a-z]{2,3}\.[a-z]{2}$/i))) {
          // MATCHED '.??.??' OR '.???.??' FROM END - e.g. '.CO.UK', '.COM.AU'
          var tokens = host.split('.');
          var size = tokens.length;
          host = tokens[size - 3] +  '.' + tokens[size-2] + '.' + tokens[size-1];
       
        } else if (host.match(new RegExp(/\.[a-z]{2,4}$/i))) {
          // MATCHED '.??' or '.???' or '.????' FROM END - e.g. '.US', '.COM', '.INFO'
          var tokens = host.split('.');
          var size = tokens.length;
          host = tokens[size-2] + '.' + tokens[size-1];
        }
      }

      if (!host)
        return;

      var value = {
        count: 1,
        first: this.created,
        last: this.created,
        parents: this.parents.count,
        children: this.children.count
      };

      serverInfo = hosts[host];
      if (!serverInfo)
        return;

      if (serverInfo.countryCode) {
        emit({ 
                client: this.campaign.client,
                countryCode: serverInfo.countryCode
             },
             value);

        emit({ 
                client: this.campaign.client,
                countryCode: serverInfo.countryCode,
                state: this.state
             },
             value);
      }

      if (serverInfo.regionName) {
        emit({
                client: this.campaign.client,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName
              },
              value);

        emit({
                client: this.campaign.client,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName,
                state: this.state
              },
              value);
      }

      if (serverInfo.cityName) {
        emit({
                client: this.campaign.client,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName,
                cityName: serverInfo.cityName
              },
              value);
        emit({
                client: this.campaign.client,
                countryCode: serverInfo.countryCode,
                regionName: serverInfo.regionName,
                cityName: serverInfo.cityName,
                state: this.state
              },
              value);
      }
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
      out: {
        merge: 'hostLocationStats'
      },
      query: {
        'campaign.client': campaign.client
      },
      scope: {
        hosts: hosts
      }
    };

    logger.info('hostClientLocationStats: Running mapreduce job for %s', campaign.name);
    var collection = collections['infringements'];
    collection.mapReduce(map, reduce, options, reallyDone);
  }

  function marshalHosts(done, err, docs) {
    var hosts = {};

    logger.info('hostClientLocationStats: Marshalling hosts')

    if (err)
      return reallyDone(err);

    docs.forEach(function(host) {
      hosts[host._id] = host.serverInfo;
    });

    done(hosts);
  }

  function getHostInfo(done) {
    logger.info('hostClientLocationStats: Getting hosts')
    var collection = collections.hosts;
    collection.find({ serverInfo: { $exists: true }},
                    {
                      'serverInfo.countryCode': 1,
                      'serverInfo.regionName': 1,
                      'serverInfo.cityName': 1
                    })
              .toArray(marshalHosts.bind(null, done));
  }

  logger.info('hostClientLocationStats: Constructing mapreduce job for %s', campaign.name);
  getHostInfo(runMapReduceJob);
}

HostsMR.hostClientBasicStats = function(db, collections, campaign, done) {
    
    var map = function() {
      var key = {
        client: this.campaign.client,
        host: 'unknown'
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
      out: {
        merge: 'hostBasicStats'
      },
      query: {
        'campaign.client': campaign.client
      }
    };

    logger.info('hostClientBasicStats: Running mapreduce job for %s', campaign.name);
    var collection = collections['infringements'];
    collection.mapReduce(map, reduce, options, done);
}
