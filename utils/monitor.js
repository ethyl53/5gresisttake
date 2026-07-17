'use strict';
// The old monitor mutated work_sessions fields. New intervals deliberately have
// no hidden timeout state; an open interval remains until the user/admin stops it.
function initMonitor() { return () => {}; }
module.exports = { initMonitor };
