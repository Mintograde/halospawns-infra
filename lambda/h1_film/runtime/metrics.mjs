import fs from 'node:fs';
import { exportWriteBuffer } from './export-write-buffer.mjs';

const started = performance.now();
const capacity = Number(process.env.H1_EXPORT_BUFFER_BYTES ?? 0);
const buffered = capacity ? exportWriteBuffer(fs.writeSync, Number(process.env.H1_EXPORT_HANDLE), capacity) : null;
if (buffered) fs.writeSync = buffered.write;
process.on('exit', code => {
  try { buffered?.flush(); }
  catch (error) {
    // An exception in an exit listener does not override process.exit(0).
    // A failed final write must never look like a successful simulation.
    process.exitCode = 1;
    throw error;
  }
  fs.writeFileSync(process.env.H1_EXPORT_METRICS, JSON.stringify({
    platform: process.platform, arch: process.arch, node: process.version, exitCode: code,
    wallSeconds: (performance.now() - started) / 1000,
    resourceUsage: process.resourceUsage(), memoryUsage: process.memoryUsage(),
    ...(buffered ? {exportWriteBuffer: buffered.stats} : {}),
  }, null, 2) + '\n', { flag: 'wx' });
});
