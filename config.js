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
  return valuegi;
}

var config = exports;

config.EXCLUDE_ROLES = getArrayEnv(process.env.SENTRY_EXCLUDE_ROLES, []);

config.INCLUDE_ROLES = getArrayEnv(process.env.SENTRY_INCLUDE_ROLES, []);

config.MAX_WORKERS = getEnv(process.env.SENTRY_MAX_WORKERS, 32);

config.ANNOUNCE_EXPIRE_TIME_SECONDS = getEnv(process.env.SENTRY_ANNOUNCE_EXPIRE_TIME_SECONDS, 60);
