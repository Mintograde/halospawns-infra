import { fileURLToPath } from 'node:url';
import { fingerprintTree } from '../source-fingerprint.mjs';

const root = process.argv[2] ?? fileURLToPath(new URL('../../../../', import.meta.url));
export const entries = [
  'lambda/h1_film/encoder/Cargo.toml', 'lambda/h1_film/encoder/Cargo.lock',
  'lambda/h1_film/encoder/src', 'lambda/h1_film/pose_codec/Cargo.toml',
  'lambda/h1_film/pose_codec/Cargo.lock', 'lambda/h1_film/pose_codec/src',
  'lambda/replay_parser/native/src/viewer.rs', 'lambda/replay_parser/contracts/replays',
];
console.log(JSON.stringify({ entries, tree: await fingerprintTree(root, entries) }, null, 2));
