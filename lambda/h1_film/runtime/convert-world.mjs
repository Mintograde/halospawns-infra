// Private worker entry point, with fixed local paths and no cloud credentials.
import assert from 'node:assert/strict';
import {readFile, unlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {convertFilm} from './convert.mjs';
import {convertMatchTrack} from './convert-match-tracks.mjs';
import {inspectMatchFilm, matchFilmPolicy} from './match-film.mjs';
import {profileById, selectExporter} from './profiles.mjs';
import {resolveEngine} from './engine-store.mjs';

const {index, simulation, conversion, timeout} = JSON.parse(await readFile('world.json', 'utf8'));
const pin = conversion.engine, binding = conversion.map_binding;
const profile = selectExporter(profileById(binding.engine_profile), pin.exporter_revision);
const engine = await resolveEngine(profile, process.env.H1_ENGINE_ROOT);
assert.equal(engine.hashes.wasm_sha256, pin.wasm_sha256);
assert.equal(engine.hashes.glue_sha256, pin.glue_sha256);
const film = resolve('input.h1film'), bytes = await readFile(film);
const match = inspectMatchFilm(bytes, matchFilmPolicy(pin.exporter_revision));
assert.equal(match.sha256, conversion.source.sha256);
assert.equal(match.host.map, binding.scenario);
assert.equal(match.host.tick_rate, conversion.film.tick_rate);
assert.ok(Number.isInteger(index) && index >= 0 && index < match.parts.length);
const report = {engine_profile:profile.id, exporter_revision:pin.exporter_revision, simulation,
  envelope:{tick_rate:match.host.tick_rate},
  provenance:{...engine.hashes, engine_source:profile.source, map_sha256:binding.raw_source.sha256}};
const values = {film, assets:resolve('.'), engine:engine.glue, profile:profile.id,
  encoder:fileURLToPath(new URL('../bin/h1-film-encoder', import.meta.url)),
  'map-catalog':resolve('maps.json'), 'exporter-revision':String(pin.exporter_revision),
  'engine-permissions':true};
const stage = resolve('result');
const track = await convertMatchTrack(stage, values, report, convertFilm, performance.now()+timeout*1000,
  bytes, match, match.parts[index]);
// The parent already has the exact bytes of a full client in the pinned match.
// Only thin clients need the upstream restorer's output shipped back.
if (!(track.part.rest.flags & 1)) await unlink(join(stage, track.id + '.h1film'));
await writeFile(join(stage,'track.json'), JSON.stringify(track), {flag:'wx'});
