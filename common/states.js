/*
 * states.js: system states
 *
 * NOTE: Keep states tied to domains so they don't all get confusing
 */

exports.scraper = {

  jobState: {
    QUEUED: 0,
    PAUSED: 1,
    STARTED: 2,
    COMPLETED: 3,
    CANCELLED: 4,
    ERRORED: 5,
    EXPIRED: 6
  }

};