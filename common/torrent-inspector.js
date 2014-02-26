var acquire = require('acquire')
  , fs = require('fs')
  , logger = acquire('logger').forFile('bittorrent-inspector.js')
  , isTextorBinary = require('istextorbinary')
  , path = require('path')
	, readTorrent = require('read-torrent')
	, rimraf = require('rimraf')
  , util = require('util')
	, utilities = acquire('utilities')
  , sugar = require('sugar')
	;

var Extensions = acquire('wrangler-rules').typeMediaExtensions
  , Seq = require('seq')
	;

var TorrentInspector = module.exports;

TorrentInspector.checkIfTorrentIsGoodFit = function(torrent, campaign, done) {
  var	campaignName = campaign.name
    , campaignNameRegExp = new RegExp('(' + campaignName.replace(/\ /gi, '|') + ')', 'i')
    , campaignReleaseDate = campaign.metadata.releaseDate
    , type = campaign.type
    , created = Date.create(torrent.created)
    , name = torrent.name
    , totalSize = 0
    , filenames = []
    , minSize = 0
    , maxSize = 4 * 1024 * 1024 //4GB for video file
    , requiredExtensions = []
    , points = 0
    ;

  logger.info('Checking if %s is a good fit', torrent.name);

  // Load up the basics
  torrent.files.forEach(function(file) {
    filenames.push(file.name);
    totalSize += file.length;
  });

  // First check the date and the name. Either not matching is automatic fail
  if (created.isBefore(campaignReleaseDate)) {
    done(null, false, util.format('%s created before release data of media (%s < %s)', name, created, campaignReleaseDate));
    return;
  }

  if (!name.match(campaignNameRegExp)) {
    done(null, false, util.format('%s doesn\'t contain the name of the campaign (%s)', name, campaignName));
    return;
  }

  // Setup the per-type contraints
  if (type.startsWith('music')) {
    minSize = 3 * 1024 * 1024;
    maxSize = 300 * 1024 * 1024;
    requiredExtensions.add(Extensions[type]) 
  
  } else if (type.startsWith('movie')) {
    minSize = 300 * 1024 * 1024;
    requiredExtensions.add(Extensions[type])

  } else {
    done(null, false, util.format('Unsupported campaign type for %s: %s', type))
    return;
  }

  // Check type constraints
  if (totalSize < minSize) {
    done(null, false, util.format('%s size is too small (%d < %d)', name, totalSize, minSize));
    return;
  }

  if (totalSize > maxSize) {
    done(null, false, util.format('%s size is too large (%d > %d)', name, totalSize, maxSize));
    return;
  }
  
  var oneMatched = false;
  filenames.forEach(function(filename) {
    requiredExtensions.forEach(function(ext) {
      if (filename.endsWith(ext))
        oneMatched = true;
    });
  });

  if (!oneMatched) {
    done(null, false, util.format('%s didn\'t contain any matching file extensions', name));
    return;
  }

  // \o/
  done(null, true, torrent.infoHash);
}

TorrentInspector.getTorrentDetails = function(torrentSource, targetPath, done) {
  var filename = path.join(targetPath, utilities.genLinkKey(torrentSource+Date.now()))
    , result =  {success: false, torDetails : null, message : ''};
    ;
    // first check to make sure it actually is a binary file before passing it to readtorrent
  Seq()
    .seq(function(){
      var that = this;
      utilities.requestStream(torrentSource, function(err, req, res, stream) {
        if (err){
          result.message = 'Error requesting link ' + err;
          return done(null, result);
        }

        stream.pipe(fs.createWriteStream(filename));
        stream.on('end', function() { 
          that();
        });
        stream.on('error', function(err) {
          result.message = 'Error requesting link ' + err;
          done(null, result);
        });
      });
    })
    .seq(function(downloaded){
      isTextorBinary.isBinary(filename, null, this);
    })
    .seq(function(isBinary) {
      if(!isBinary){
        logger.info('we think its not binary');
        result.message = 'Not binary';
        return done(null, result);
      }      
      logger.info('we think its binary');
      readTorrent(filename, this);
    })
    .seq(function(details) {
      rimraf(filename, this.ok);
      result.success = true;
      result.torDetails = details;
      done(null, result);
    })
    .catch(function(err){
      done(err);
    })
    ;
}
