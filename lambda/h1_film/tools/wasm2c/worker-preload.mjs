// The offline harness explicitly mounts this bridge. Production child_environment
// removes NODE_OPTIONS and cannot select it. The native host is not sandbox ready.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

assert.equal(process.env.H1_AOT_OFFLINE, '1');
if (process.argv[1]?.endsWith('/convert.mjs')) {
  const original = childProcess.spawn;
  childProcess.spawn = function(command, args, options) {
    if (command === process.execPath && args.includes('--deterministic') && args.includes('input.h1film')) {
      const filtered = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--permission' || args[i].startsWith('--allow-fs-')) continue;
        if (args[i] === '--import' && args[i + 1].endsWith('/engine-permissions.mjs')) { i++; continue; }
        filtered.push(args[i]);
      }
      const env = { ...options.env };
      delete env.NODE_OPTIONS;
      return original.call(this, command, ['--import=/native-tools/preload.mjs', ...filtered], { ...options, env });
    }
    return original.call(this, command, args, options);
  };
  syncBuiltinESMExports();
}
