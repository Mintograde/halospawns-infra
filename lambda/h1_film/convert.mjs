import { parseArgs } from 'node:util';
import { convertFilm } from './runtime/convert.mjs';

const { values } = parseArgs({ options: {
  film: { type: 'string' }, assets: { type: 'string' }, engine: { type: 'string' },
  'engine-root': { type: 'string' }, profile: { type: 'string' },
  encoder: { type: 'string' }, reference: { type: 'string' }, output: { type: 'string' },
  timeout: { type: 'string', default: '1800' },
  'trusted-local': { type: 'boolean', default: false },
  'skip-readback': { type: 'boolean', default: false },
  analytics: { type: 'boolean', default: false }, 'map-catalog': { type: 'string' },
} });

try {
  console.log(JSON.stringify(await convertFilm(values), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
