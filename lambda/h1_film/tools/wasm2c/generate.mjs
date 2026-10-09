// Offline runtime experiment: generate a Node-API host for WABT 1.0.32's C translation.
// Generated engine source and binaries are private and must stay outside the repo.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [directory, wasmPath] = process.argv.slice(2);
assert.ok(directory && wasmPath);
const header = await readFile(join(directory, 'engine.h'), 'utf8');
const wasm = await readFile(wasmPath);
const module = new WebAssembly.Module(wasm);
const imports = [...header.matchAll(/\/\* import: '([^']+)' '([^']+)' \*\/\s+(void|u32|u64|f32|f64) (\w+)\(([^)]*)\);/g)];
const exports = [...header.matchAll(/\/\* export: '([^']+)' \*\/\s+(void|u32|u64|f32|f64) (\w+)\(([^)]*)\);/g)];
const byImport = (a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name);
assert.deepEqual(imports.map(([, module, name]) => ({ module, name, kind: 'function' })).sort(byImport),
  WebAssembly.Module.imports(module).sort(byImport));
assert.deepEqual(exports.map(([, name]) => name).sort(),
  WebAssembly.Module.exports(module).filter(v => v.kind === 'function').map(v => v.name).sort());
assert.deepEqual(WebAssembly.Module.exports(module).filter(v => v.kind !== 'function'), [
  { name: 'memory', kind: 'memory' }, { name: '__indirect_function_table', kind: 'table' },
]);
const types = {
  u32: ['int32', 'uint32', 'uint32_t'],
  u64: ['bigint_int64', 'bigint_uint64', 'uint64_t'],
  f32: ['double', 'double', 'double'],
  f64: ['double', 'double', 'double'],
};
function fromJs(type, input, name) {
  const [, get, native] = types[type];
  return `${native} ${name}; CHECK(napi_get_value_${get}(env, ${input}, &${name}${type === 'u64' ? ', &lossless' : ''}));`;
}
function toJs(type, input, output) {
  return `CHECK(napi_create_${types[type][0]}(env, ${type === 'u32' ? `(int32_t)${input}` : type === 'u64' ? `(int64_t)${input}` : input}, &${output}));`;
}
const parts = [`
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include "wasm-rt-impl.h"
#include "engine.h"
#define CHECK(call) do { if ((call) != napi_ok) napi_fatal_error("h1-aot", NAPI_AUTO_LENGTH, #call, NAPI_AUTO_LENGTH); } while (0)
struct Z_env_instance_t { int unused; };
struct Z_wasi_snapshot_preview1_instance_t { int unused; };
static napi_env env;
static napi_ref callbacks[${imports.length}];
static Z_h1_instance_t instance;
static struct Z_env_instance_t host;
static struct Z_wasi_snapshot_preview1_instance_t wasi;
static int initialized;
static void no_free(napi_env e, void *data, void *hint) { (void)e; (void)data; (void)hint; }
static napi_value memory_buffer(napi_env e, napi_callback_info info) {
  napi_value result;
  wasm_rt_memory_t *m = Z_h1Z_memory(&instance);
  CHECK(napi_create_external_arraybuffer(e, m->data, m->size, no_free, NULL, &result));
  return result;
}
static napi_value memory_grow(napi_env e, napi_callback_info info) {
  napi_value arg, result; size_t count = 1; uint32_t pages;
  CHECK(napi_get_cb_info(e, info, &count, &arg, NULL, NULL));
  CHECK(napi_get_value_uint32(e, arg, &pages));
  uint32_t old = wasm_rt_grow_memory(Z_h1Z_memory(&instance), pages);
  if (old == UINT32_MAX) { napi_throw_range_error(e, NULL, "AOT memory growth failed"); return NULL; }
  CHECK(napi_create_uint32(e, old, &result)); return result;
}
`];
for (const [index, match] of imports.entries()) {
  const [, , , result, name, signature] = match;
  const [instanceType, ...args] = signature.split(',').map(x => x.trim());
  assert.ok(args.every(x => types[x]));
  parts.push(`${result} ${name}(${instanceType} host${args.map((t,i) => `, ${t} p${i}`).join('')}) {
    napi_handle_scope scope; napi_value fn, receiver, result, args[${Math.max(1,args.length)}]; bool lossless;
    CHECK(napi_open_handle_scope(env, &scope));
    CHECK(napi_get_reference_value(env, callbacks[${index}], &fn));
    CHECK(napi_get_undefined(env, &receiver));
    ${args.map((t,i) => toJs(t,`p${i}`,`args[${i}]`)).join('\n')}
    CHECK(napi_call_function(env, receiver, fn, ${args.length}, args, &result));
    ${result === 'void' ? '' : fromJs(result,'result','value')}
    CHECK(napi_close_handle_scope(env, scope));
    ${result === 'void' ? '' : 'return value;'}
  }`);
}
for (const [index, match] of exports.entries()) {
  const [, , result, name, signature] = match;
  const args = signature.split(',').map(x => x.trim()).slice(1);
  assert.ok(args.every(x => types[x]));
  parts.push(`static napi_value exported_${index}(napi_env e, napi_callback_info info) {
    napi_value args[${Math.max(1,args.length)}], result; size_t count = ${args.length}; bool lossless;
    CHECK(napi_get_cb_info(e, info, &count, args, NULL, NULL));
    if (count != ${args.length}) { napi_throw_type_error(e, NULL, "Wrong AOT argument count"); return NULL; }
    ${args.map((t,i) => fromJs(t,`args[${i}]`,`p${i}`)).join('\n')}
    if (wasm_rt_impl_try()) { napi_throw_error(e, NULL, "Native WASM trap"); return NULL; }
    ${result === 'void' ? '' : `${result} value = `}${name}(&instance${args.map((_,i)=>`, p${i}`).join('')});
    ${result === 'void' ? 'CHECK(napi_get_undefined(e, &result));' : toJs(result,'value','result')}
    return result;
  }`);
}
parts.push(`static napi_value instantiate(napi_env e, napi_callback_info info) {
  napi_value argument, group, fn, result, memory, table; size_t count = 1;
  if (initialized) { napi_throw_error(e, NULL, "Only one offline engine per process"); return NULL; }
  initialized = 1; env = e;
  CHECK(napi_get_cb_info(e, info, &count, &argument, NULL, NULL));
  ${imports.map(([, group, name],index) => `CHECK(napi_get_named_property(e, argument, ${JSON.stringify(group)}, &group));
    CHECK(napi_get_named_property(e, group, ${JSON.stringify(name)}, &fn));
    CHECK(napi_create_reference(e, fn, 1, &callbacks[${index}]));`).join('\n')}
  wasm_rt_init(); Z_h1_init_module();
  if (wasm_rt_impl_try()) { napi_throw_error(e, NULL, "Native WASM initialization trapped"); return NULL; }
  Z_h1_instantiate(&instance, &host, &wasi);
  CHECK(napi_create_object(e, &result));
  ${exports.map(([, name],index)=>`CHECK(napi_create_function(e, ${JSON.stringify(name)}, NAPI_AUTO_LENGTH, exported_${index}, NULL, &fn));
    CHECK(napi_set_named_property(e, result, ${JSON.stringify(name)}, fn));`).join('\n')}
  CHECK(napi_create_object(e, &memory));
  napi_property_descriptor properties[] = {
    {"buffer", NULL, NULL, memory_buffer, NULL, NULL, napi_default, NULL},
    {"grow", NULL, memory_grow, NULL, NULL, NULL, napi_default, NULL}
  };
  CHECK(napi_define_properties(e, memory, 2, properties));
  CHECK(napi_set_named_property(e, result, "memory", memory));
  CHECK(napi_create_object(e, &table));
  CHECK(napi_set_named_property(e, result, "__indirect_function_table", table));
  return result;
}
static napi_value init(napi_env e, napi_value exports) {
  napi_value fn, hash;
  CHECK(napi_create_function(e, "instantiate", NAPI_AUTO_LENGTH, instantiate, NULL, &fn));
  CHECK(napi_set_named_property(e, exports, "instantiate", fn));
  CHECK(napi_create_string_utf8(e, "${createHash('sha256').update(wasm).digest('hex')}", NAPI_AUTO_LENGTH, &hash));
  CHECK(napi_set_named_property(e, exports, "wasm_sha256", hash));
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
`);
await writeFile(join(directory,'host.c'), parts.join('\n'), {flag:'wx'});
console.log(JSON.stringify({imports:imports.length,exports:exports.length}));
