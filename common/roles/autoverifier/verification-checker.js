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
  var md5s = downloads.map(function(download){return download.md5});

  Seq()
    .seq(function(){    
      verifications.get({"campaign" : campaign, "md5s": md5s}, this);
    })
    .seq(function(verifications){
      logger.info('verifications : ' + JSON.stringify(verifications));
      if(verifications.isEmpty()){
        logger.info('No recorded verifications for ' + JSON.stringify(md5s));
        return done();
      }
      done(null, verifications);
    })
    .catch(function(err){
      done(err);
    })
    ;
}
