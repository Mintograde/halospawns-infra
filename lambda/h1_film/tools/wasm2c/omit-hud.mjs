// Offline diagnostic: isolate the cost of the unused HUD probability calculation.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [directory] = process.argv.slice(2);
const source = await readFile(join(directory, 'engine.c'), 'utf8');
const anchor = 'static void w2c_blampc_spawn_odds_tick(Z_h1_instance_t* instance) {';
assert.equal(source.split(anchor).length, 2, 'Unexpected translated engine');
await writeFile(join(directory, 'engine-no-hud.c'), source.replace(anchor,
  'static void w2c_blampc_spawn_odds_tick(Z_h1_instance_t* instance) { (void)instance; }\n'
  + 'static void w2c_unused_spawn_odds_tick(Z_h1_instance_t* instance) {'), {flag:'wx'});
