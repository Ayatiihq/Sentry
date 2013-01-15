/*
 * config.js: the configuration module
 *
 * (C) 2012 Ayatii Limited
 *
 */

var sugar = require('sugar');

function getEnv(value, defaultValue) {
  return typeof value !== 'undefined' ? value : defaultValue;
}

// Splits out FOO_BAR="baz,boe,bun" into an array
function getArrayEnv(value, defaultValue) {
  value = typeof value !== 'undefined' ? value.split(',') : defaultValue;
  return value;
}

var config = exports;

config.EXCLUDE_ROLES = getArrayEnv(process.env.SENTRY_EXCLUDE_ROLES, []);

config.INCLUDE_ROLES = getArrayEnv(process.env.SENTRY_INCLUDE_ROLES, []);

config.MAX_WORKERS = getEnv(process.env.SENTRY_MAX_WORKERS, 32);

config.ANNOUNCE_EXPIRE_TIME_SECONDS = getEnv(process.env.SENTRY_ANNOUNCE_EXPIRE_TIME_SECONDS, 180);

config.EXCLUDE_SCRAPERS = getArrayEnv(process.env.SENTRY_EXCLUDE_SCRAPERS, []);

config.INCLUDE_SCRAPERS = getArrayEnv(process.env.SENTRY_INCLUDE_SCRAPERS, []);

config.DATABASE_URL = getEnv(process.env.DATABASE_URL, 'postgres://aclmotoryefhcq:1dtTxQOUqGrrSGpWrgB8iKyE3o@ec2-54-243-250-1.compute-1.amazonaws.com:5432/df778jkmqe298e');

// Governor
config.GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES = getEnv(process.env.SENTRY_GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES, 15);