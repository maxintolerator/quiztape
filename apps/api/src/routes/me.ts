import { Hono } from 'hono';

import { notImplemented } from './not-implemented';

export const me = new Hono()
  .get('/', notImplemented(2, 'current user profile'))
  .get('/sync', notImplemented(2, 'backfill progress'))
  .get('/settings', notImplemented(3, 'optional category toggles'))
  .patch('/settings', notImplemented(3, 'update optional category toggles'));
