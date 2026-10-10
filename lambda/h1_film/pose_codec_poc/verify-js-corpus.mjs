import { readdir, readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [viewer, nativeDirectory, outputDirectory, countArg = '32'] = process.argv.slice(2);
if (!outputDirectory) throw new Error('Usage: node verify-js-corpus.mjs VIEWER_REPO NATIVE_OUTPUT NEW_OUTPUT [COUNT]');
const expected = Number(countArg), claimed = new Set(), results = [];
await mkdir(outputDirectory);
const started = Date.now();
async function worker() {
  while (results.length < expected) {
    if (Date.now() - started > 60 * 60 * 1000) throw new Error('Timed out waiting for native reports');
    const names = (await readdir(nativeDirectory)).filter(n => /^\d{3}-.*\.report\.json$/.test(n)).sort();
    const name = names.find(n => !claimed.has(n));
    if (!name) { await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
    claimed.add(name);
    // Native reports are small and written only after the full readback succeeds.
    let report;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { report = JSON.parse(await readFile(path.join(nativeDirectory, name), 'utf8')); break; }
      catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    if (report.partial || !report.readback.all_non_pose_fields_exact) throw new Error(`Incomplete report: ${name}`);
    const destination = path.join(outputDirectory, name.slice(0, 3) + '.json');
    const log = await open(destination + '.log', 'wx');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./verify-js.mjs', import.meta.url)), viewer,
          report.input, report.output, destination, 'sample'], { stdio: ['ignore', log.fd, log.fd], windowsHide: true });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`JS check failed: ${name}`)));
      });
      const js = JSON.parse(await readFile(destination, 'utf8'));
      results.push({ ordinal: name.slice(0, 3), indices: js.indices, ticks: js.ticks, nodes: js.nodes,
        all_non_pose_fields_exact: js.all_non_pose_fields_exact, max_position: js.max_position, max_point_bound: js.max_point_bound });
      console.log(JSON.stringify({ ordinal: name.slice(0, 3), completed: results.length, expected }));
    } finally { await log.close(); }
  }
}
await Promise.all([worker(), worker()]);
await writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify({ schema: 'halospawns.poseCodecJsCorpus.v1',
  mode: 'first-middle-last chunks per film, reverse order', results: results.sort((a, b) => a.ordinal.localeCompare(b.ordinal)) }, null, 2) + '\n', { flag: 'wx' });
