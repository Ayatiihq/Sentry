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

config.NO_NOTIFY = getEnv(process.env.SENTRY_NO_NOTIFY, 0);

// External Services
config.AZURE_NETWORK_ACCOUNT = getEnv(process.env.AZURE_NETWORK_ACCOUNT, 'nucleus');

config.AZURE_NETWORK_KEY = getEnv(process.env.AZURE_NETWORK_KEY, 'IoPtjg8kxGXJoHrD6ucPMOrTnSdUPW02t3i9pFVH1gRRQv5gBhT68sS+LNeZF8wyctRXK4lyyee1o3sNXf0SLw==');

config.AZURE_CORE_ACCOUNT = getEnv(process.env.AZURE_CORE_ACCOUNT, 'goldrush');

config.AZURE_CORE_KEY = getEnv(process.env.AZURE_CORE_KEY, '0LkjUUtQeAzaOccb5rkQbTT2sql8YrldYYdO4RhKnT4OTNfK+diveKbuDvqmxz0poyB9m2VpafBQLySvsaXNOA==');

config.AZURE_SERVICE_BUS_CONN_KEY = getEnv(process.AZURE_SERVICE_BUS_CONN_KEY, 'Endpoint=sb://junction.servicebus.windows.net/;SharedSecretIssuer=owner;SharedSecretValue=Bf+b/OpNVBQtIx1NkWI9TKPtU2VrE0/FPs9N0UbNKLs=');

config.SENDGRID_USER = getEnv(process.SENTRY_SENDGRID_USER, 'medic');

config.SENDGRID_KEY = getEnv(process.SENTRY_SENDGRID_KEY, 'H1uUh83AN49313U');

// Mongo
config.MONGODB_URL = getEnv(process.env.SENTRY_MONGODB_URL, 'mongodb://scout:3HVb62MG2Yy4mWm@kingslanding0.7kingdoms.me:6001,kingslanding1.7kingdoms.me:6001/goldrush?replicaSet=KingsLanding');

config.MONGODB_PORTS = getEnv(process.env.SENTRY_MONGODB_SERVERS, ['6001', '6002', '6003']);

config.MONGODB_DATABASE = getEnv(process.env.SENTRY_MONGODB_DATABASE, 'goldrush');

config.MONGODB_USERNAME = getEnv(process.env.SENTRY_MONGODB_USERNAME, 'scout');

config.MONGODB_PASSWORD = getEnv(process.env.SENTRY_MONGODB_PASSWORD, '3HVb62MG2Yy4mWm');

config.MONGODB_REPLICA_NAME = getEnv(process.env.SENTRY_MONGODB_REPLICA_NAME, 'KingsLanding');

// Hub
config.SENTRY_HUB_ADDRESS="kingsguard.7kingdoms.me"

config.HUB_PORT = getEnv(process.env.SENTRY_HUB_PORT, 4444);

config.HUB_SECRET = getEnv(process.env.SENTRY_HUB_SECRET, 'W0b|7B3N1@-7[N]');

config.HUB_NO_TASKS = getEnv(process.env.SENTRY_HUB_NO_TASKS, 0);

config.HUB_GIT_BRANCH = getEnv(process.env.SENTRY_HUB_GIT_BRANCH, 'master')

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

// Standard Dispatcher
config.STANDARD_CHECK_INTERVAL_MINUTES = getEnv(process.env.SENTRY_STANDARD_CHECK_INTERVAL_MINUTES, 10);

config.STANDARD_JOB_EXPIRES_SECONDS = getEnv(process.env.SENTRY_STANDARD_JOB_EXPIRES_SECONDS, 60 * 60 * 12);

config.STANDARD_JOB_TIMEOUT_MINUTES = getEnv(process.env.SENTRY_STANDARD_JOB_TIMEOUT_MINUTES, 10);

// Verify

// Misc
config.SENTRY_SELENIUM_CONSOLE_ADDRESS="http://khaleesi.7kingdoms.me:4444/grid/console"
config.SELENIUM_HUB_ADDRESS="http://khaleesi.7kingdoms.me:4444/wd/hub"
config.SENTRY_SELENIUM_CONSOLE_PROXY_CLASS=".proxy"
config.SELENIUM_CONSOLE_BUSY_CLASS = getEnv(process.env.SENTRY_SELENIUM_CONSOLE_BUSY_CLASS, '.busy');
config.NODE_TLS_REJECT_UNAUTHORIZED="0"