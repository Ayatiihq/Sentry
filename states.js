/*
 * states.js: system states
 *
 * NOTE: Keep states tied to domains so they don't all get confusing
 */

exports.scraper = {

  jobState: {
    QUEUED: 0,
    PAUSED: 1,
    COMPLETED: 2,
    CANCELLED: 3,
    ERRORED: 4
  }

};