import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Map every requested host frame by the same recorded pairtime rule as mapViewFrame.
// Build the row lookup once so a long clip does not rescan the full clock table per tick.
export function clientInterval(host, client, start, end) {
  const rows = (client.alignment?.rows ?? []).filter(([local, server]) => local >= 0 && server >= 0);
  if (!rows.length || !client.clocks?.length || start < 0 || end > host.frame_count || end <= start) return null;
  const first = host.first_update + start + 1, last = host.first_update + end;
  const latest = new Int32Array(end - start).fill(-1);
  let maxServer = -1;
  for (const [i, [,server]] of rows.entries()) {
    maxServer = Math.max(maxServer, server);
    if (server <= last) latest[Math.max(0, server - first)] = i;
  }
  if (latest[0] < 0 || last > maxServer) return null;
  const clocks = [], frames = new Map();
  let index = -1, low = Infinity, high = -Infinity;
  for (let i = 0; i < latest.length; i++) {
    index = Math.max(index, latest[i]);
    const [local, server] = rows[index];
    const clock = Math.min(local + first + i - server, rows[index + 1]?.[0] ?? Infinity);
    clocks.push(clock);
    frames.set(clock, null);
    low = Math.min(low, clock);
    high = Math.max(high, clock);
  }
  // Clock jumps can leave a hole or record a game time twice. Only unique frames
  // count as coverage. Keep consecutive original client frames at their native pace.
  for (const [i, segment] of client.clocks.entries()) {
    const length = (client.clocks[i + 1]?.frame ?? client.frame_count) - segment.frame;
    const stop = Math.min(high + 1, segment.game_tick + length);
    for (let clock = Math.max(low, segment.game_tick); clock < stop; clock++) {
      if (frames.has(clock)) frames.set(clock, frames.get(clock) === null ? segment.frame + clock - segment.game_tick : -1);
    }
  }
  let previous = -1;
  for (const clock of clocks) {
    const frame = frames.get(clock);
    if (frame === null || frame < 0 || frame < previous) return null;
    previous = frame;
  }
  return {start: frames.get(clocks[0]), end: previous + 1};
}

export async function attachedTrack(view, job, readObject) {
  const host = view.host_track;
  assert.ok(host.id === 'host' && host.generation_id === job.artifact_id
    && host.frame_count === job.source.tick_count && host.artifact.sha256 === job.source.sha256
    && view.tick_rate === job.rate && view.timeline.size_bytes <= 32 * 1024 * 1024);
  const read = await readObject(view.timeline);
  const bytes = await read(0, view.timeline.size_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), view.timeline.sha256);
  const t = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  assert.ok(t.contract === 'halospawns.h1ClientViewTimeline.v1' && t.attempt_id === view.id
    && t.host_artifact_id === job.artifact_id && t.source_film_sha256 === view.source_film_sha256
    && t.clock_source_film_sha256 === view.clock_source_film_sha256 && t.frame_count === view.frame_count
    && t.first_update === view.first_update && t.alignment_method === 'beta5-client-clock-v1');
  return {id:'client-' + view.source_film_sha256, recorded_own_player:view.recorded_own_player,
    frame_count:t.frame_count, clocks:t.clocks, alignment:{rows:t.alignment_rows}, artifact:view.artifact};
}
