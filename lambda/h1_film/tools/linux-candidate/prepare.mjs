import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintTree } from '../source-fingerprint.mjs';

const [sourceArgument, outputArgument] = process.argv.slice(2);
assert.ok(sourceArgument && outputArgument, 'Supply archived source and a new output directory');
const source = resolve(sourceArgument), output = resolve(outputArgument);
const shared = fileURLToPath(new URL('../../engines/beta3/', import.meta.url));
const revision = JSON.parse(await readFile(join(source, 'source-revision.json'), 'utf8'));
assert.match(revision.git_commit, /^[0-9a-f]{40}$/);
const fingerprint = await fingerprintTree(source, ['CMakeLists.txt', 'engine', 'host', 'tools']);
assert.equal(fingerprint.sha256, revision.sha256, 'Archived source changed');
const nativeSource = await fingerprintTree(source, ['CMakeLists.txt', 'engine', 'host', 'tools', 'linux_server', 'scripts']);
await mkdir(output);
await copyFile(join(shared, 'export.c'), join(output, 'export.c'));
function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, `Unrecognized source anchor: ${before}`);
  return text.replace(before, after);
}
let stream = await readFile(join(shared, 'stream.h'), 'utf8');
stream = replaceOnce(stream, '#include <io.h>', '#include <unistd.h>');
stream = replaceOnce(stream,
  'int fd = _open_osfhandle((intptr_t)_strtoui64(handle, NULL, 10), _O_BINARY | _O_WRONLY);',
  'char *end;\n            long descriptor = strtol(handle, &end, 10);\n            if (*end || descriptor < 3 || descriptor > 1024) hs_fail("invalid output descriptor");\n            int fd = dup((int)descriptor);');
stream = replaceOnce(stream, '_fdopen(fd, "wb")', 'fdopen(fd, "wb")');
stream = replaceOnce(stream, 'if (_setmode(_fileno(hs_output), _O_BINARY) < 0) hs_fail("cannot set binary output");', 'if (!hs_output) hs_fail("missing output stream");');
stream = replaceOnce(stream, 'setvbuf(hs_output, NULL, _IOFBF, 64 * 1024);',
  '#ifdef H1_BUFFERED_EXPORT\n        static char output_buffer[64 * 1024];\n        if (setvbuf(hs_output, output_buffer, _IOFBF, sizeof output_buffer)) hs_fail("cannot buffer encoder pipe");\n#else\n        setvbuf(hs_output, NULL, _IOFBF, 64 * 1024);\n#endif');
await writeFile(join(output, 'stream.h'), stream);
let film = await readFile(join(source, 'host/blampc_film.c'), 'utf8');
film = replaceOnce(film, 'film_pad_load(g_file, &g_env);', '(void)0;');
film = replaceOnce(film, 'if (g_kf_failed || !film_keyframe_open())', 'if (1)');
film = replaceOnce(film, '"maps\\\\%s.map"', '"maps/%s.map"');
await writeFile(join(output, 'film_sequential.c'), film);
await writeFile(join(output, 'candidate.c'),
  `const char *blampc_menu_build_label(void) { return "${revision.git_commit === 'e78e4daa4b6d6b3e9ca290e3ebfe7a993ed558ad' ? `${revision.git_date} - BETA 4` : `UNIVERSAL Only - ${revision.git_date}`} - ${revision.git_commit.slice(0, 8)}"; }\nvoid hs_unused_spawn_odds_tick(void) { }\n`);
await writeFile(join(output, 'inputs.json'), JSON.stringify({
  schema: 'halospawns.h1LinuxCandidateInputs.v1', source: { ...revision, native_tree: nativeSource },
  exporter: await fingerprintTree(resolve(shared, '..'), ['beta3', 'beta4']),
  integration: await fingerprintTree(fileURLToPath(new URL('./', import.meta.url)), ['CMakeLists.txt', 'beta4.cmake', 'prepare.mjs', 'build.ps1', 'trap-stubs.mjs', 'include', 'platform.c', 'headless-extra.c', 'measure.c']),
  excluded_work: ['theater pad cache', 'seek keyframes', 'spawn-odds HUD calculation'],
}, null, 2) + '\n');
