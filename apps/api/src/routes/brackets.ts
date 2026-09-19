import { Hono } from 'hono';

import type { AppEnv } from '../app';
import { notImplemented } from './not-implemented';

export const brackets = new Hono<AppEnv>()
  .post('/', notImplemented(6, 'seed a bracket from top artists'))
  .get('/:bracketId', notImplemented(6, 'bracket state'))
  .post('/:bracketId/picks', notImplemented(6, 'advance a pick'));
