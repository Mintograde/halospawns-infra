import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

const [url, output, playwrightRoot] = process.argv.slice(2);
if (!output) throw new Error('Usage: node check-preview.mjs URL OUTPUT_DIRECTORY [PLAYWRIGHT_PACKAGE_ROOT]');
let packageRoot = playwrightRoot;
if (!packageRoot) {
  const links = path.join(process.env.LOCALAPPDATA, 'ms-playwright/.links');
  for (const file of await readdir(links)) {
    const candidate = (await readFile(path.join(links, file), 'utf8')).trim();
    if (candidate.includes('playwright')) { packageRoot = candidate; break; }
  }
}
const require = createRequire(path.join(packageRoot, 'package.json'));
const { chromium } = require(packageRoot);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  await page.waitForFunction(() => window.poseLab?.ready, { timeout: 60000 });
  const geometry = await page.evaluate(() => ({ maxVertexError: window.poseLab.maxVertexError, verticesChecked: window.poseLab.verticesChecked, layoutMismatches: window.poseLab.layoutMismatches, frames: window.poseLab.frames,
    browserDecodedChunks: window.poseLab.browserDecodedChunks, browserDecodedTicks: window.poseLab.browserDecodedTicks,
    browserChunkBytes: window.poseLab.browserChunkBytes, maxReferenceDifference: window.poseLab.maxReferenceDifference }));
  assert.equal(geometry.layoutMismatches, 0);
  assert.ok(geometry.verticesChecked > 1000 && geometry.maxVertexError < 0.0002);
  assert.ok(geometry.browserDecodedChunks >= 1 && geometry.browserDecodedTicks >= geometry.frames);
  assert.ok(geometry.maxReferenceDifference < 1e-6);
  const views = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { window.poseLab.pause(); window.poseLab.select(0); });
    await page.waitForTimeout(250);
    const before = await page.evaluate(() => window.poseLab.pixels());
    assert.ok(before.every(p => p.colored > 100));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `pose-${viewport.width}.png`) });
    await page.evaluate(() => window.poseLab.select(128));
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.poseLab.pixels());
    assert.ok(before.some((p, i) => p.checksum !== after[i].checksum), 'Pose must move');
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.55, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(250);
    const orbited = await page.evaluate(() => window.poseLab.pixels());
    assert.ok(orbited.some((p, i) => p.checksum !== after[i].checksum), 'Orbit must change canvas');
    views.push({ viewport, before, after, orbited });
  }
  assert.deepEqual(errors, []);
  const result = { geometry, views, errors };
  await writeFile(path.join(output, 'browser-check.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
