import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../handler.mjs';

test('foundation never accepts jobs or extra health fields', async () => {
  const previous = process.env.H1_WORKER_MODE;
  try {
    process.env.H1_WORKER_MODE = 'foundation';
    for (const event of [undefined, null, [], {}, 'health',
      { Records: [{ messageId: 'would-be-acknowledged', body: '{}' }] },
      { schema: 'halospawns.h1FilmHealth.v1', action: 'convert' },
      { schema: 'halospawns.h1FilmHealth.v1', action: 'health', film: '/tmp/film' },
      { schema: 'halospawns.h1FilmHealth.v1', action: 'health', Records: [] },
    ]) {
      await assert.rejects(handler(event), /intake is not implemented/);
    }
    for (const mode of ['', 'enabled', 'conversion']) {
      process.env.H1_WORKER_MODE = mode;
      await assert.rejects(handler({ schema: 'halospawns.h1FilmHealth.v1', action: 'health' }),
        /Unsupported H1 worker mode/);
    }
  } finally {
    if (previous === undefined) delete process.env.H1_WORKER_MODE;
    else process.env.H1_WORKER_MODE = previous;
  }
});
