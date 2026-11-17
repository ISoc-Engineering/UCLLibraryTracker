// Production entry point: the real app, with live data fetched directly from
// UCL's seat-availability page. Contains no demo code.
//
// The demo (generated data) is a separate entry point, src/demo/worker.js,
// selected with `wrangler dev --env demo` (see wrangler.jsonc).

import { createApp } from './app.js';
import { uclSource } from './sources/uclSource.js';

export default createApp(uclSource);
