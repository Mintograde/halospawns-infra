import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { expandFrame, hashCanonicalStream } from '../tools/canonical-transport.mjs';

const integer = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value >>> 0); return bytes; };
const float = value => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); return bytes; };
const text = value => Buffer.concat([integer(Buffer.byteLength(value)), Buffer.from(value)]);
const tagged = (tag, bytes = Buffer.alloc(0)) => Buffer.concat([Buffer.from([tag]), bytes]);
const object = fields => tagged(9, Buffer.concat([integer(fields.length),
  ...fields.flatMap(([key, value]) => [text(key), value])]));
const array = values => tagged(8, Buffer.concat([integer(values.length), ...values]));
const stream = (magic, frames) => Buffer.concat([Buffer.from(magic),
  ...frames.flatMap(frame => [integer(frame.length), frame])]);

function fixture() {
  const coordinates = [-0, 1.25, -2.5, 1, 0, -0, 0, 0, 1];
  const world = tagged(10, Buffer.concat([integer(0x80000001), integer(-3), text('é'),
    ...coordinates.map(float), integer(-1), integer(0x80000002)]));
  const oldWorld = object([
    ['object_id', tagged(4, integer(0x80000001))], ['object_type', tagged(3, integer(-3))],
    ['tag_name', tagged(7, text('é'))],
    ...['x', 'y', 'z', 'forward_x', 'forward_y', 'forward_z', 'up_x', 'up_y', 'up_z']
      .map((key, index) => [key, tagged(5, float(coordinates[index]))]),
    ['parent_ref', tagged(3, integer(-1))], ['owner_object_ref', tagged(4, integer(0x80000002))],
  ]);
  const spawn = tagged(11, Buffer.concat([integer(7), ...[-0, 2.5, 3, -1.5].map(float),
    ...[-1, 0, 1, -1, 32767].map(integer)]));
  const oldSpawn = object([
    ['spawn_index', tagged(3, integer(7))], ...['x', 'y', 'z', 'facing']
      .map((key, index) => [key, tagged(5, float([-0, 2.5, 3, -1.5][index]))]),
    ['team', tagged(3, integer(-1))], ['gametypes', array([0, 1, -1, 32767].map(value => tagged(3, integer(value))))],
  ]);
  const components = Array.from({ length: 13 }, (_, index) => index ? index / 8 : -0);
  const matrix = tagged(12, Buffer.concat(components.map(float)));
  const oldMatrix = array(components.map(value => tagged(5, float(value))));
  return { packed: object([['objects', array([world])], ['spawns', array([spawn])], ['nodes', array([matrix])]]),
    canonical: object([['objects', array([oldWorld])], ['spawns', array([oldSpawn])], ['nodes', array([oldMatrix])]]) };
}

test('packed records reconstruct complete original bytes, including signed zero and reference types', () => {
  const { packed, canonical } = fixture();
  assert.deepEqual(expandFrame(packed), canonical);
  for (let length = 0; length < packed.length; length++) {
    assert.throws(() => expandFrame(packed.subarray(0, length)));
  }
  assert.throws(() => expandFrame(Buffer.concat([packed, Buffer.from([0])])));
  assert.throws(() => expandFrame(packed, Buffer.alloc(16)));
  assert.throws(() => expandFrame(object([['matrix', tagged(12, Buffer.concat(Array(13).fill(float(Infinity))))]])));
});

test('stream hashes are independent of pipe fragmentation and retain wire identity', async () => {
  const { packed, canonical } = fixture();
  const current = stream('HSFT0002', [packed, packed]);
  const original = stream('HSFT0001', [canonical, canonical]);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const size of [1, 2, 7, 32, current.length]) {
    const chunks = [];
    for (let index = 0; index < current.length; index += size) chunks.push(current.subarray(index, index + size));
    const proof = await hashCanonicalStream(chunks, 'HSFT0002');
    assert.equal(proof.transport_bytes, current.length);
    assert.equal(proof.transport_sha256, digest(current));
    assert.equal(proof.canonical_bytes, original.length);
    assert.equal(proof.canonical_sha256, digest(original));
  }
  const proof = await hashCanonicalStream([original]);
  assert.equal(proof.transport_sha256, proof.canonical_sha256);
  await assert.rejects(hashCanonicalStream([current], 'HSFT0001'));
  await assert.rejects(hashCanonicalStream([current.subarray(0, current.length - 1)], 'HSFT0002'));
  await assert.rejects(hashCanonicalStream([Buffer.from('HSFT0002'), integer(0xffffffff)], 'HSFT0002'));
});

test('base-export comparison omits only root combat while retaining every other byte', async () => {
  const base = object([['position', tagged(5, float(-0))],
    ['nested', object([['combat', tagged(3, integer(9))]])]]);
  const extra = object([['position', tagged(5, float(-0))],
    ['combat', object([['damage', tagged(5, float(1.5))]])],
    ['nested', object([['combat', tagged(3, integer(9))]])]]);
  assert.deepEqual(expandFrame(extra, undefined, { omitCombat: true }), base);
  const original = await hashCanonicalStream([stream('HSFT0001', [base])]);
  const candidate = await hashCanonicalStream([stream('HSFT0002', [extra])],
    'HSFT0002', { omitCombat: true });
  assert.equal(candidate.canonical_sha256, original.canonical_sha256);
  assert.notEqual(candidate.transport_sha256, original.transport_sha256);
  const changed = Buffer.from(extra);
  changed[18] ^= 1;
  const different = await hashCanonicalStream([stream('HSFT0002', [changed])],
    'HSFT0002', { omitCombat: true });
  assert.notEqual(different.canonical_sha256, original.canonical_sha256);
  assert.throws(() => expandFrame(object([['combat', tagged(0)], ['combat', tagged(0)]]),
    undefined, { omitCombat: true }), /Duplicate combat/);
});
