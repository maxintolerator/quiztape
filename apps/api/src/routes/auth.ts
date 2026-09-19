import { Hono } from 'hono';

import { notImplemented } from './not-implemented';

/** Last.fm web-auth: redirect out, receive ?token=, exchange for a session key, mint an app session. Step 2. */
export const auth = new Hono()
  .get('/lastfm/start', notImplemented(2, 'redirect to Last.fm auth page'))
  .get('/lastfm/callback', notImplemented(2, 'exchange token for session key'))
  .post('/logout', notImplemented(2, 'revoke app session'));
