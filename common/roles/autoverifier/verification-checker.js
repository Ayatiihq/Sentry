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


