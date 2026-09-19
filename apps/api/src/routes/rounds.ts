import { Hono } from 'hono';

import { notImplemented } from './not-implemented';

export const rounds = new Hono()
  .post('/', notImplemented(3, 'generate a round for mode/difficulty/length'))
  .get('/:roundId', notImplemented(3, 'round state'))
  .post('/:roundId/answers', notImplemented(3, 'grade an answer'))
  .get('/:roundId/results', notImplemented(5, 'results and recap'));
