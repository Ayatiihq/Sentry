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

config.EXCLUDE_SPIDERS = getArrayEnv(process.env.SENTRY_EXCLUDE_SPIDERS, []);

config.INCLUDE_SPIDERS = getArrayEnv(process.env.SENTRY_INCLUDE_SPIDERS, []);

// External Services
config.AZURE_NETWORK_ACCOUNT = getEnv(process.env.AZURE_NETWORK_ACCOUNT, 'nucleus');

config.AZURE_NETWORK_KEY = getEnv(process.env.AZURE_NETWORK_KEY, 'IoPtjg8kxGXJoHrD6ucPMOrTnSdUPW02t3i9pFVH1gRRQv5gBhT68sS+LNeZF8wyctRXK4lyyee1o3sNXf0SLw==');

config.AZURE_CORE_ACCOUNT = getEnv(process.env.AZURE_CORE_ACCOUNT, 'goldrush');

config.AZURE_CORE_KEY = getEnv(process.env.AZURE_CORE_KEY, '0LkjUUtQeAzaOccb5rkQbTT2sql8YrldYYdO4RhKnT4OTNfK+diveKbuDvqmxz0poyB9m2VpafBQLySvsaXNOA==');

config.AZURE_SERVICE_BUS_CONN_KEY = getEnv(process.AZURE_SERVICE_BUS_CONN_KEY, 'Endpoint=sb://junction.servicebus.windows.net/;SharedSecretIssuer=owner;SharedSecretValue=Bf+b/OpNVBQtIx1NkWI9TKPtU2VrE0/FPs9N0UbNKLs=');

// Governor
config.GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES = getEnv(process.env.SENTRY_GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES, 15);

config.GOVERNOR_SPIDER_CHECK_DELAY_MINUTES = getEnv(process.env.SENTRY_GOVERNOR_SPIDER_CHECK_DELAY_MINUTES, 15);

config.SCRAPER_QUEUE = getEnv(process.env.SENTRY_SCRAPER_QUEUE, 'scraper');

config.SCRAPER_QUEUE_PRIORITY = getEnv(process.env.SENTRY_SCRAPER_QUEUE_PRIORITY, 'scraper-priority');

config.SCRAPER_JOB_TIMEOUT_SECONDS = getEnv(process.env.SENTRY_SCRAPER_JOB_TIMEOUT_SECONDS, 60 * 5);

config.SCRAPER_JOB_EXPIRES_SECONDS = getEnv(process.env.SENTRY_SCRAPER_JOB_EXPIRES_SECONDS, 60 * 60 * 12); // 12 hours

config.SPIDER_QUEUE = getEnv(process.env.SENTRY_SPIDER_QUEUE, 'spider');

config.SPIDER_QUEUE_PRIORITY = getEnv(process.env.SENTRY_SPIDER_QUEUE_PRIORITY, 'spider-priority');

config.SPIDER_JOB_TIMEOUT_SECONDS = getEnv(process.env.SENTRY_SPIDER_JOB_TIMEOUT_SECONDS, 60 * 10);

config.SPIDER_JOB_EXPIRES_SECONDS = getEnv(process.env.SENTRY_SPIDER_JOB_EXPIRES_SECONDS, 60 * 60 * 12); // 12 hours

// Miner
config.MINER_CHECK_INTERVAL_MINUTES = getEnv(process.env.MINER_CHECK_INTERVAL_MINUTES, 30);