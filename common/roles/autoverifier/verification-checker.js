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


VerChecker.checkDownload = function(verifications, campaign, download, done){

  Seq()
    .seq(function(){
      verifications.get({"campaign" : campaign, "md5": download.md5}, this);
    })
    .seq(function(verification){
    	if(verification.isEmpty()){
    		logger.info('No recorded verification for this download for this campaign ');
    		return done();
    	}

  		if(verification.length > 1){
  			logger.warn('We have multiple verications against a single md5, thats a problem - ' + JSON.stringify(verification));
        return done(new Error("Getting multiple verifications for one md5")); //should this error here
  		}

      logger.info('\n\n\nJust found a singular verification against this md5 ' + JSON.stringify(verification[0]));
      
      // Success
      var result = {score: verification[0].score,
                    verified: verification[0].verified,
                    assetNumber: verification[0].assetNumber};
      

      done(null, result);
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
      var that = this;
      VerChecker.checkDownload(verifications, campaign, download, function(err, verification){
        if(err)
          return that(err);
        if(!verification)
          return that();
        // otherwise go populate
        results[download.md5][verification.assetNumber -1] = verification;
        that();
      });
    })
    .seq(function(){
      done(null, results);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

