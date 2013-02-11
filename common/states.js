/*
 * states.js: system states
 *
 * NOTE: Keep states tied to domains so they don't all get confusing
 */

exports.jobs = {
  state: {
    QUEUED: 0,
    PAUSED: 1,
    STARTED: 2,
    COMPLETED: 3,
    CANCELLED: 4,
    ERRORED: 5,
    EXPIRED: 6
  }
};

exports.infringements = {
  state: {
    UNVERIFIED: 0,
    VERIFIED: 1,
    FALSE_POSITIVE: 2,
    NEEDS_SCRAPE: 3,
    DEFERRED: 4
  }
};