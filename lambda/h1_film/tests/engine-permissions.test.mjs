import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('retained glue constants work without restoring forbidden bindings or child processes', () => {
  const url = new URL('../runtime/engine-permissions.mjs', import.meta.url);
  const bridge = fileURLToPath(url);
  const result = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${bridge}`,
    '--import', url.href, '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { spawnSync } from 'node:child_process';
      assert.equal(process.binding('constants').fs.O_RDONLY, fs.constants.O_RDONLY);
      assert.throws(() => process.binding('fs'), { code: 'ERR_ACCESS_DENIED' });
      assert.throws(() => fs.readFileSync('package.json'), { code: 'ERR_ACCESS_DENIED' });
      assert.throws(() => spawnSync(process.execPath, ['--version']), { code: 'ERR_ACCESS_DENIED' });
    `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
