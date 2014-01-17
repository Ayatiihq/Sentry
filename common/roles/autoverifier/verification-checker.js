/*
 * verification-checker.js: 
 * (C) 2014 Ayatii Limited
 *
 * Supposed to used  by verifiers as a helper module to query verifications
 * against the given downloads and campaign.
 *
 */

var acquire = require('acquire')
  , logger = acquire('logger').forFile('verification-checker.js')    
  ;

var Seq = require('seq');

var VerChecker = module.exports;

VerChecker.checkDownload = function(verifications, campaign, download, results, done){

  Seq()
    .seq(function(){
      verifications.get({"campaign" : campaign, "md5": download.md5}, this);
    })
    .seq(function(verification){
    	if(verification.isEmpty()){
    		logger.info('No recorded verification for this download for this campaign ');
    		return done();
    	}

  		if(verifications.length > 1){
  			logger.warn('We have multiple verications against a single md5, thats a problem - ' + JSON.stringify(verifications));
        return done();
  		}
      // Success
      var result = {score: verification.score,
                    verified: verification.verified,
                    assetNumber: verification.assetNumber};

			results[download.md5].insert(result, verification.assetNumber);
      logger.info('Just found a singular verification against this md5 ' + JSON.stringify(result));

      done();
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/**
 * Returns a results map
 * {
    downloadMd5 : [
                    {score: 0.0,
                     verified:t/f,
                     assetNumber: 0 .. campaign.metadata.assets.length || -1},
                      .
                      . 
                      n = campaign.metadata.assets.length
                    ],
                    .
                    .
                    N number of downloads
  }

 *
 * @param  {object}   verifications      A handle on a verifications object.
 * @param  {object}   campaign           The campaign in question.
 * @param  {object}   downloads      	   An array of download objects (from the infringement).
 * @param  {function} done      		     Exit point.
 */
VerChecker.checkDownloads = function(verifications, campaign, downloads, done){
  	
	var results = {};
	
	// setup the results map
	downloads.each(function(dl){
		var arr = [];
		campaign.metadata.assets.each(function(track){
			arr.push({score: 0.0, verified: false, assetNumber: -1});
		});
		results[dl.md5] = arr; 
	});

  Seq(downloads)
    .seqEach(function(download){
      VerChecker.checkDownload(verifications, campaign, download, results, this);
    })
    .seq(function(){
      done(results);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

