import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outputArgument] = process.argv.slice(2);
assert.ok(outputArgument, 'Supply a new private worker staging directory');
const output = resolve(outputArgument);
const worker = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(output);
for (const entry of ['engines', 'runtime', 'profiles']) {
  await cp(join(worker, entry), join(output, entry), { recursive: true, errorOnExist: true });
}
await mkdir(join(output, 'tools'));
for (const entry of ['build-engine.ps1', 'describe-build.mjs', 'source-fingerprint.mjs']) {
  await cp(join(worker, 'tools', entry), join(output, 'tools', entry));
}
await cp(new URL('./include/xinput.h', import.meta.url), join(output, 'engines/h1arena/wasm/include/xinput.h'));
await cp(new URL('./include/candidate-platform.h', import.meta.url), join(output, 'engines/h1arena/wasm/include/candidate-platform.h'));
await cp(new URL('./platform.c', import.meta.url), join(output, 'engines/h1arena/wasm/candidate-platform.c'));
await cp(new URL('./headless-extra.c', import.meta.url), join(output, 'engines/h1arena/wasm/headless-extra.c'));
let cmake = await readFile(join(output, 'engines/h1arena/wasm/CMakeLists.txt'), 'utf8');
cmake += '\ntarget_sources(h1-film PRIVATE candidate-platform.c headless-extra.c "${H1_SOURCE}/host/blampc_any_device.c" "${H1_SOURCE}/host/blampc_viewer_input.c")\n';
cmake += 'set_property(SOURCE "${CMAKE_CURRENT_BINARY_DIR}/film_sequential.c" APPEND PROPERTY COMPILE_OPTIONS -include candidate-platform.h)\n';
cmake += 'target_sources(h1-film PRIVATE "${H1_SOURCE}/host/blampc_picture_probe.c")\n';
cmake += 'set_property(SOURCE "${H1_SOURCE}/host/blampc_picture_probe.c" APPEND PROPERTY COMPILE_OPTIONS -include candidate-platform.h)\n';
await writeFile(join(output, 'engines/h1arena/wasm/CMakeLists.txt'), cmake);
