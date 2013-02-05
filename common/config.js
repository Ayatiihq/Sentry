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

// External Services
config.DATABASE_URL = getEnv(process.env.DATABASE_URL, 'postgres://evqkjcjargxydk:WEUFwJzuOEqasrOfGxKCWjVb8B@ec2-54-243-229-57.compute-1.amazonaws.com:5432/d2brn3c2pum57a');

config.IRONMQ_TOKEN = getEnv(process.env.IRONMQ_TOKEN, 'yTY3n98ywCuj1HpMMe2_6dp8a7U');

config.IRONMQ_PROJECT = getEnv(process.env.IRONMQ_PROJECT, '50cf775e8e7d1447f5004d56');

config.AZURE_NETWORK_ACCOUNT = getEnv(process.env.AZURE_NETWORK_ACCOUNT, 'nucleus');

config.AZURE_NETWORK_KEY = getEnv(process.env.AZURE_NETWORK_KEY, 'IoPtjg8kxGXJoHrD6ucPMOrTnSdUPW02t3i9pFVH1gRRQv5gBhT68sS+LNeZF8wyctRXK4lyyee1o3sNXf0SLw==');

// Governor
config.GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES = getEnv(process.env.SENTRY_GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES, 15);

config.SCRAPER_QUEUE = getEnv(process.env.SENTRY_SCRAPER_QUEUE, 'scraper');

config.SCRAPER_QUEUE_PRIORITY = getEnv(process.env.SENTRY_SCRAPER_QUEUE_PRIORITY, 'scraper.priority');

config.SCRAPER_JOB_TIMEOUT_SECONDS = getEnv(process.env.SENTRY_SCRAPER_JOB_TIMEOUT_SECONDS, 60);

config.SCRAPER_JOB_EXPIRES_SECONDS = getEnv(process.env.SENTRY_SCRAPER_JOB_EXPIRES_SECONDS, 60 * 60 * 12); // 12 hours