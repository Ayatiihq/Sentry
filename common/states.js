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
    SENT_NOTICE: 3,
    TAKEN_DOWN: 4,
    NEEDS_SCRAPE: 5,
    DEFERRED: 6,
    UNAVAILABLE: 7
  }
};

exports.hub = {
  state: {
    RUNNING: 0,
    PAUSED: 1,
    NEEDS_UPDATE: 2
  }
};

exports.node = {
  state: {
    RUNNING: 0,
    PAUSING: 1,
    PAUSED: 2,
    NEEDS_UPDATE: 3
  }
};

exports.notices = {
  state: {
    PENDING: 0,
    PROCESSED: 1
  }
};