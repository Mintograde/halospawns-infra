import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {remoteMatchTracks} from '../runtime/world-pool.mjs';

test('labelled worlds start immediately, empty labels wait for host proof, throttled work falls back in order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'h1-worlds-'));
  const socket = process.platform === 'win32' ? '//./pipe/h1-worlds-' + process.pid : join(dir, 'world.sock');
  const requests = [], fallback = [], first = Promise.withResolvers(), host = Promise.withResolvers();
  const server = createServer(connection => {
    connection.once('data', bytes => {
      requests.push(JSON.parse(bytes));
      if (requests.length === 1) first.resolve();
      connection.end('null');
    });
  });
  try {
    await new Promise((resolve,reject) => server.once('error',reject).listen(socket,resolve));
    const match = {parts:['','known',''].map((build,index) => ({index,envelope:{build}}))};
    const report = {exporter_revision:49};
    let active = 0;
    const result = remoteMatchTracks({match, report, socket, hostReady:host.promise,
      deadline:performance.now()+5000, concurrency:2, local:async part => {
        assert.equal(active++,0);
        await delay(1);
        fallback.push(part.index);
        active--;
        return part.index;
      }});
    await first.promise;
    assert.deepEqual(requests, [{index:1, simulation:null}]);
    report.simulation = {hash_checks:24};
    host.resolve(true);
    assert.deepEqual(await result, [0,1,2]);
    assert.deepEqual(fallback, [0,1,2]);
    assert.deepEqual(requests.slice(1).map(r => r.simulation), [report.simulation,report.simulation]);
    assert.deepEqual(report.world_pool, {remote:0, local:3});
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive:true,force:true});
  }
});
