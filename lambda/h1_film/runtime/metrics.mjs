import { writeFileSync } from 'node:fs';

const started = performance.now();
process.on('exit', code => {
  writeFileSync(process.env.H1_EXPORT_METRICS, JSON.stringify({
    platform: process.platform, arch: process.arch, node: process.version, exitCode: code,
    wallSeconds: (performance.now() - started) / 1000,
    resourceUsage: process.resourceUsage(), memoryUsage: process.memoryUsage(),
  }, null, 2) + '\n', { flag: 'wx' });
});
