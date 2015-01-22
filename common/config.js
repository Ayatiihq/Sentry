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

var config = exports
  , env = process.env
  ;

config.EXCLUDE_ROLES = getArrayEnv(env.SENTRY_EXCLUDE_ROLES, []);

config.INCLUDE_ROLES = getArrayEnv(env.SENTRY_INCLUDE_ROLES, []);

config.MAX_WORKERS = getEnv(env.SENTRY_MAX_WORKERS, 32);

config.ANNOUNCE_EXPIRE_TIME_SECONDS = getEnv(env.SENTRY_ANNOUNCE_EXPIRE_TIME_SECONDS, 180);

config.EXCLUDE_SCRAPERS = getArrayEnv(env.SENTRY_EXCLUDE_SCRAPERS, []);

config.INCLUDE_SCRAPERS = getArrayEnv(env.SENTRY_INCLUDE_SCRAPERS, []);

config.EXCLUDE_SPIDERS = getArrayEnv(env.SENTRY_EXCLUDE_SPIDERS, []);

config.INCLUDE_SPIDERS = getArrayEnv(env.SENTRY_INCLUDE_SPIDERS, []);

config.NO_NOTIFY = getEnv(env.SENTRY_NO_NOTIFY, 0);

// External Services
config.AZURE_NETWORK_ACCOUNT = getEnv(env.AZURE_NETWORK_ACCOUNT, '');

config.AZURE_NETWORK_KEY = getEnv(env.AZURE_NETWORK_KEY, '');

config.AZURE_CORE_ACCOUNT = getEnv(env.AZURE_CORE_ACCOUNT, '');

config.AZURE_CORE_KEY = getEnv(env.AZURE_CORE_KEY, '');

config.AZURE_SERVICE_BUS_CONN_KEY = getEnv(process.AZURE_SERVICE_BUS_CONN_KEY, '');

config.SENDGRID_USER = getEnv(process.SENTRY_SENDGRID_USER, '');

config.SENDGRID_KEY = getEnv(process.SENTRY_SENDGRID_KEY, '');

// Mongo
config.MONGODB_URL = getEnv(env.SENTRY_MONGODB_URL, '');

config.MONGODB_PORTS = getEnv(env.SENTRY_MONGODB_SERVERS, ['6001', '6002', '6003']);

config.MONGODB_DATABASE = getEnv(env.SENTRY_MONGODB_DATABASE, '');

config.MONGODB_USERNAME = getEnv(env.SENTRY_MONGODB_USERNAME, '');

config.MONGODB_PASSWORD = getEnv(env.SENTRY_MONGODB_PASSWORD, '');

config.MONGODB_REPLICA_NAME = getEnv(env.SENTRY_MONGODB_REPLICA_NAME, '');

// Hub
config.HUB_ADDRESS = getEnv(env.SENTRY_HUB_ADDRESS, "");

config.HUB_PORT = getEnv(env.SENTRY_HUB_PORT, 0);

config.HUB_SECRET = getEnv(env.SENTRY_HUB_SECRET, '');

config.HUB_NO_TASKS = getEnv(env.SENTRY_HUB_NO_TASKS, 0);

config.HUB_GIT_BRANCH = getEnv(env.SENTRY_HUB_GIT_BRANCH, '')

// Governor
config.GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES = getEnv(env.SENTRY_GOVERNOR_CAMPAIGN_CHECK_DELAY_MINUTES, 15);

config.GOVERNOR_SPIDER_CHECK_DELAY_MINUTES = getEnv(env.SENTRY_GOVERNOR_SPIDER_CHECK_DELAY_MINUTES, 15);

config.SCRAPER_QUEUE = getEnv(env.SENTRY_SCRAPER_QUEUE, 'scraper');

config.SCRAPER_QUEUE_PRIORITY = getEnv(env.SENTRY_SCRAPER_QUEUE_PRIORITY, 'scraper-priority');

config.SCRAPER_JOB_TIMEOUT_SECONDS = getEnv(env.SENTRY_SCRAPER_JOB_TIMEOUT_SECONDS, 60 * 5);

config.SCRAPER_JOB_EXPIRES_SECONDS = getEnv(env.SENTRY_SCRAPER_JOB_EXPIRES_SECONDS, 60 * 60 * 12); // 12 hours

config.SPIDER_QUEUE = getEnv(env.SENTRY_SPIDER_QUEUE, 'spider');

config.SPIDER_QUEUE_PRIORITY = getEnv(env.SENTRY_SPIDER_QUEUE_PRIORITY, 'spider-priority');

config.SPIDER_JOB_TIMEOUT_SECONDS = getEnv(env.SENTRY_SPIDER_JOB_TIMEOUT_SECONDS, 60 * 10);

config.SPIDER_JOB_EXPIRES_SECONDS = getEnv(env.SENTRY_SPIDER_JOB_EXPIRES_SECONDS, 60 * 60 * 12); // 12 hours

// Standard Dispatcher
config.STANDARD_CHECK_INTERVAL_MINUTES = getEnv(env.SENTRY_STANDARD_CHECK_INTERVAL_MINUTES, 10);

config.STANDARD_JOB_EXPIRES_SECONDS = getEnv(env.SENTRY_STANDARD_JOB_EXPIRES_SECONDS, 60 * 60 * 12);

config.STANDARD_JOB_TIMEOUT_MINUTES = getEnv(env.SENTRY_STANDARD_JOB_TIMEOUT_MINUTES, 10);

// Selenium
config.SELENIUM_CONSOLE_ADDRESS =  getEnv(env.SENTRY_SELENIUM_CONSOLE_ADDRESS, '');

config.SELENIUM_HUB_ADDRESS = getEnv(env.SENTRY_SELENIUM_HUB_ADDRESS, '');

config.SELENIUM_CONSOLE_PROXY_CLASS = getEnv(env.SENTRY_SELENIUM_CONSOLE_PROXY_CLASS, '');

config.SELENIUM_CONSOLE_BUSY_CLASS = getEnv(env.SENTRY_SELENIUM_CONSOLE_BUSY_CLASS, '');

// Cowmangler
config.COWMANGLER_HUB_ADDRESS = getEnv(env.COWMANGLER_HUB_ADDRESS, '');

config.COWMANGLER_HUB_PORT = getEnv(env.COWMANGLER_HUB_PORT, '');

// Hadouken
config.HADOUKEN_ADDRESS = getEnv(env.HADOUKEN_ADDRESS, '');

config.HADOUKEN_PORT = getEnv(env.HADOUKEN_PORT, '');

// Redis
config.REDIS_HOST = getEnv(env.REDIS_HOST, '');

config.REDIS_AUTH = getEnv(env.REDIS_AUTH, '');

config.REDIS_PORT = getEnv(env.REDIS_PORT, );

// AWS
config.AWS_KEY = getEnv(env.SENTRY_AWS_KEY, '');

config.AWS_SECRET = getEnv(env.SENTRY_AWS_SECRET, '');

config.AWS_BUCKET = getEnv(env.SENTRY_AWS_BUCKET, '');

// Torrent
config.RTORRENT_HOST = getEnv(env.SENTRY_RTORRENT_HOST, '');

config.RTORRENT_PORT = getEnv(env.SENTRY_RTORRENT_PORT, '');
