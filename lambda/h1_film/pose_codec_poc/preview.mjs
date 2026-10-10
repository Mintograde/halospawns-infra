import { createServer } from 'node:http';
import { readFile, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { zstdDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [viewer, glb, report, port = '5187'] = process.argv.slice(2);
if (!report) throw new Error('Usage: node preview.mjs VIEWER_REPO MODEL.glb JS_REPORT [PORT]');
const require = createRequire(path.resolve(viewer, 'packages/viewer/package.json'));
const three = path.resolve(path.dirname(require.resolve('three')), '..');
const fzstd = path.resolve(path.dirname(require.resolve('fzstd')), '../esm/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const posePath = JSON.parse(await readFile(report, 'utf8')).experiment;
const artifact = await open(posePath, 'r');
let manifest, payloadBase;
try {
  const header = Buffer.alloc(32);
  if ((await artifact.read(header, 0, 32, 0)).bytesRead !== 32 || header.toString('ascii', 0, 8) !== 'H1POSE01') throw new Error('Invalid experiment');
  const size = header.readUInt32LE(16);
  if (size > 64 * 1024 * 1024) throw new Error('Manifest too large');
  const bytes = Buffer.alloc(size);
  if ((await artifact.read(bytes, 0, size, 32)).bytesRead !== size) throw new Error('Truncated manifest');
  manifest = JSON.parse(zstdDecompressSync(bytes));
  payloadBase = 32 + size;
} finally { await artifact.close(); }
function child(root, suffix) {
  const target = path.resolve(root, suffix);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Path outside root');
  return target;
}
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/pose-manifest.json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(manifest));
      return;
    }
    const chunkMatch = /^\/pose-chunks\/(\d+)\.zst$/.exec(pathname);
    if (chunkMatch) {
      const chunk = manifest.chunks[Number(chunkMatch[1])];
      if (!chunk || !Number.isSafeInteger(chunk.offset) || chunk.offset < 0 || chunk.compressedBytes <= 0 || chunk.compressedBytes > 64 * 1024 * 1024) throw new Error('Invalid chunk');
      const start = payloadBase + chunk.offset;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': chunk.compressedBytes, 'Cache-Control': 'no-store' });
      await pipeline(createReadStream(posePath, { start, end: start + chunk.compressedBytes - 1 }), response);
      return;
    }
    let filename;
    if (pathname === '/') filename = path.join(here, 'preview.html');
    else if (pathname === '/preview-client.mjs') filename = path.join(here, 'preview-client.mjs');
    else if (pathname === '/decode-pose.mjs') filename = path.join(here, 'decode-pose.mjs');
    else if (pathname === '/model.glb') filename = glb;
    else if (pathname === '/report.json') filename = report;
    else if (pathname === '/fzstd.mjs') filename = fzstd;
    else if (pathname.startsWith('/three/')) filename = child(three, pathname.slice(7));
    else if (pathname.startsWith('/viewer/')) filename = child(path.resolve(viewer, 'packages/viewer/src/lib'), pathname.slice(8));
    else { response.writeHead(404).end(); return; }
    const bytes = await readFile(filename);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' })[path.extname(filename)], 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch (error) { if (response.headersSent) response.destroy(error); else response.writeHead(404).end(String(error.message)); }
});
server.listen(Number(port), '127.0.0.1', () => console.log(`Pose comparison: http://127.0.0.1:${server.address().port}`));
