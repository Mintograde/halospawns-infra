import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fingerprintTree } from './source-fingerprint.mjs';

const { values } = parseArgs({ options: {
  repository: { type: 'string' }, commit: { type: 'string' }, output: { type: 'string' },
} });
assert.ok(values.repository && values.output, 'Use --repository and a new --output directory');
const repository = resolve(values.repository), output = resolve(values.output);
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', '--verify', `${values.commit ?? 'HEAD'}^{commit}`);
assert.match(commit, /^[0-9a-f]{40}$/);
const date = git('show', '-s', '--format=%cs', commit);
await mkdir(output);
const archive = join(output, 'source.tar');
execFileSync('git', ['-C', repository, 'archive', '--format=tar', `--output=${archive}`, commit, 'src']);
execFileSync('tar', ['-xf', archive, '-C', output]);
const source = await fingerprintTree(join(output, 'src'), ['CMakeLists.txt', 'engine', 'host', 'tools']);
const provenance = { project: 'h1arena', git_commit: commit, git_date: date, ...source };
await writeFile(join(output, 'src', 'source-revision.json'), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ source: join(output, 'src'), ...provenance }));
