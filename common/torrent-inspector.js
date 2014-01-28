var acquire = require('acquire')
  , path = require('path')
	, readTorrent = require('read-torrent')
	. rimraf = require('rimraf')
	, utilities = acquire('utilities')
	;

var Seq = require('seq')
	;

var TorrentHelper = module.exports;

TorrentHelper.checkIfTorrentIsGoodFit = function(torrent, infringement, campaign, done) {
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
    , requiredExentions = []
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
    requiredExentions.add(Extensions[type]) 
  
  } else if (type.startsWith('movie')) {
    minSize = 300 * 1024 * 1024;
    requiredExentions.add(Extensions[type])

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
    requiredExentions.forEach(function(ext) {
      if (filename.endsWith(ext))
        oneMatched = true;
    });
  });

  if (!oneMatched) {
    done(null, false, util.format('%s didn\'t contain any matching file extensions', name));
    return;
  }

  // \o/
  done(null, true);
}

TorrentHelper.getTorrentDetails = function(infringement, targetPath, done) {
  var	error = null
    , filename = path.join(targetPath, infringement._id)
    , gotFile = false
    , details = null
    ;

  Seq(infringement.parents.uris)
    .seqEach(function(uri) {
      var that = this;

      if (gotFile) {
        that();
        return;
      }

      if (uri.startsWith('magnet:')) {
        that();
        return;
      }

      utilities.requestStream(uri, function(err, req, res, stream) {
        if (err) {
          error = err;
          that();
          return;
        }
        stream.pipe(fs.createWriteStream(filename));
        stream.on('end', function() { 
          gotFile = true;
          that();
        });
        stream.on('error', function(err) {
          error = err;
          that();
        });
      });
    })
    .seq(function() {
      if (!gotFile) {
        done(error);
        return;
      }

      readTorrent(filename, this);
    })
    .seq(function(details) {
      rimraf(filename, this.ok);
      done(null, details);
    })
    .catch(function(err) {
      done(err);
    })
    ;
}