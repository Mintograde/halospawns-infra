import { readdir, readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const [exe, corpus, output, rig, presetsArg = 'hierarchy-balanced', limitArg = '0', concurrencyArg = '1'] = process.argv.slice(2);
if (!exe || !corpus || !output || !rig) throw new Error('Usage: node run-corpus.mjs EXE CORPUS NEW_OUTPUT RIG [PRESETS] [MAX_CHUNKS] [CONCURRENCY]');
const presets = presetsArg.split(',');
const limit = Number(limitArg);
const concurrency = Number(concurrencyArg);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isInteger(limit) || limit < 0) throw new Error('Invalid limits');
await mkdir(output, { recursive: false });
const entries = (await readdir(corpus, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{3}-/.test(d.name)).sort((a, b) => a.name.localeCompare(b.name));
const jobs = [];
for (const entry of entries) {
  const sourceReport = JSON.parse(await readFile(path.join(corpus, entry.name, 'report.json'), 'utf8'));
  if (!['simulation_and_artifacts_verified', 'simulation_and_encoding_verified'].includes(sourceReport.status)
      || sourceReport.engine_exit?.code !== 0 || sourceReport.encoder_exit?.code !== 0) {
    throw new Error(`Unverified source ${entry.name}`);
  }
  for (const preset of presets) jobs.push({
    name: entry.name, preset,
    input: path.join(corpus, entry.name, 'candidate/replay.120hz.hsrdc'),
    output: path.join(output, `${entry.name}.${preset}.h1pc`),
    film: sourceReport.input, source_status: sourceReport.status,
    provenance: sourceReport.provenance, envelope: sourceReport.envelope
  });
}
const results = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const logfile = await open(job.output + '.log', 'wx');
    try {
      const args = ['pack', job.input, job.output, job.preset, rig, ...(limit ? [String(limit)] : [])];
      await new Promise((resolve, reject) => {
        const child = spawn(exe, args, { stdio: ['ignore', logfile.fd, logfile.fd], windowsHide: true });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${job.name}: exit ${code}; see ${job.output}.log`)));
      });
      const report = JSON.parse(await readFile(job.output.replace(/\.h1pc$/, '.report.json'), 'utf8'));
      results.push({ ...job, report });
      console.log(JSON.stringify({ name: job.name, preset: job.preset, ratio: report.ratio, bytes: report.output_bytes, maxPosition: report.errors.max_position, fallbacks: report.counts.raw_poses, completed: results.length, total: jobs.length }));
    } finally { await logfile.close(); }
  }
}));
const summary = { schema: 'halospawns.poseCodecCorpus.v1', concurrency, partial: Boolean(limit), results };
await writeFile(path.join(output, 'corpus.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
