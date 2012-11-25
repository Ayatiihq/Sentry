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
  value = typeof value !== 'undefined' ? value : defaultValue;
  return value.split(',');
}

var config = exports;

config.SINGLETON_ROLES = getArrayEnv(process.env.SENTRY_SINGLETON_ROLES, "governor");

config.EXCLUDE_ROLES = getArrayEnv(process.env.SENTRY_EXCLUDE_ROLES, "");

config.MAX_WORKERS = getEnv(process.env.SENTRY_MAX_WORKERS, 32);
