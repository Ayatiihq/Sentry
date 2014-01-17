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
  			logger.warn('We have multiple verications for this campaign against a single md5, thats a problem - ' + JSON.stringify(verification));
        return done(new Error("Getting multiple verifications for one md5")); //should this error here
  		}

      logger.info('\n\n Just found a singular verification against this md5 ' + JSON.stringify(verification[0]));
      
      // Success
      done(null, verification[0]);
    })
    .catch(function(err){
      done(err);
    })
    ;
}

/**
 * Returns a results array of verification objects
 *
 * @param  {object}   verifications      A handle on a verifications object.
 * @param  {object}   campaign           The campaign in question.
 * @param  {object}   downloads      	   An array of download objects (from the infringement).
 * @param  {function} done      		     Exit point.
 */
VerChecker.checkDownloads = function(verifications, campaign, downloads, done){
  	
	var results = [];

  Seq(downloads)
    .seqEach(function(download){
      var that = this;
      VerChecker.checkDownload(verifications, campaign, download, function(err, verification){
        if(err)
          return that(err);
        if(!verification)
          return that();
        // otherwise go populate
        results.push(verification);
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


