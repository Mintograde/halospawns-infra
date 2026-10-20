import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const [logPath, outputPath, dataPath] = process.argv.slice(2);
const log = await readFile(logPath, 'utf8');
const previous = await readFile(outputPath, 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return '';
});
const data = new Set((await readFile(dataPath, 'utf8')).split(/\s+/));
const names = new Set([...previous.matchAll(/void (\w+)\(void\)/g)].map(match => match[1]));
const missing = [...log.matchAll(/undefined symbol: (\w+)/g)].map(match => match[1]);
assert.ok(missing.length, 'Build failed without unresolved function symbols');
for (const name of missing) {
  assert.ok(!data.has(name), `Unresolved data symbol: ${name}`);
  names.add(name);
}
const result = 'void linux_trap(const char *name);\n' + [...names].sort().map(name =>
  `__attribute__((weak)) void ${name}(void) { linux_trap("${name}"); }\n`).join('');
assert.notEqual(result, previous, 'No new trap stubs; inspect the build failure');
await writeFile(outputPath, result);
console.log(`Generated ${names.size} trapping function stubs`);
