// Older recordings may have obituary text or individual death counters only.
// Keep recorded attribution, even when simultaneous counters look like a pair.
function recordedMessages(events, start, end) {
  const result = [];
  for (const event of events) {
    if (typeof event !== 'string') continue;
    const match = /^(\d+):\s*(.+)$/u.exec(event);
    if (!match) continue;
    const tick = Number(match[1]);
    if (tick < start || tick >= end) continue;
    const text = match[2].replace(/\s+\(\d+\)$/u, '');
    if (/\s(?:killed|betrayed)\s|\s(?:died|committed suicide)$/iu.test(text)) {
      result.push({tick, text});
    }
  }
  return result.sort((a, b) => a.tick - b.tick);
}

export function clipKillFeed(job, {start, end, hostFrames, hostWorld}, names) {
  const messages = [];
  function add(tick, text) {
    const hostFrame = Math.ceil(tick / job.source_stride);
    if (hostFrame < job.start || hostFrame >= job.end) return;
    const frame = (hostFrames ? hostFrames[hostFrame - job.start] : hostFrame) - start;
    if (frame >= 0 && frame < end - start) messages.push({frame, text});
  }
  if (job.feed_events === null) {
    for (const {tick, text} of recordedMessages(hostWorld.manifest.replay.events ?? [], job.source_start, job.source_end)) {
      add(tick, text);
    }
    return messages;
  }
  for (const event of job.feed_events) {
    const {kind, source_tick: tick, multikill} = event;
    const victim = names[event.victim_slot] || `Player ${event.victim_slot + 1}`;
    const killer = names[event.killer_slot];
    let text = `${victim} died`;
    if (kind === 'suicide') text = `${victim} committed suicide`;
    if (killer && kind === 'kill') text = `${killer} killed ${victim}`;
    if (killer && kind === 'betrayal') text = `${killer} betrayed ${victim}`;
    add(tick, text);
    if (multikill >= 2) {
      const award = ['Double Kill!', 'Triple Kill!', 'Killtacular!'][multikill - 2];
      add(tick, award ?? `${multikill}-kill multikill!`);
    }
  }
  return messages;
}
