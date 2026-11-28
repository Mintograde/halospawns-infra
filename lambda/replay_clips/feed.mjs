// Older recordings may have obituary text or individual death counters only.
// Keep recorded attribution, even when simultaneous counters look like a pair.
function recordedMessages(events, start, end, subject, perspectiveFeed) {
  const result = [];
  for (const event of events) {
    if (typeof event !== 'string') continue;
    const match = /^(\d+):\s*(.+)$/u.exec(event);
    if (!match) continue;
    const tick = Number(match[1]);
    if (tick < start || tick >= end) continue;
    const suffix = /\s+\((-?\d+)\)$/u.exec(match[2]);
    let text = suffix ? match[2].slice(0,suffix.index) : match[2];
    if (perspectiveFeed) {
      const passive = /^(.+) was killed by (.+)$/u.exec(text);
      if (passive) text = passive[2] + ' killed ' + passive[1];
      // A pronoun in the source refers to the original recorder, which may
      // be a different player from the featured slot.
      if (text.startsWith('You killed ')) text = text.slice(11) + ' died';
    }
    if (subject && text.startsWith(subject + ' killed ')) {
      result.push({tick, text:'You killed ' + text.slice(subject.length + 8),
        score:suffix ? Number(suffix[1]) : undefined});
      continue;
    }
    if (/\s(?:killed|betrayed)\s|\s(?:died|committed suicide)$/iu.test(text)) {
      result.push({tick, text});
    }
  }
  return result.sort((a, b) => a.tick - b.tick);
}

export function clipKillFeed(job, {start, end, hostFrames, hostWorld}, names, scores) {
  const messages = [];
  function add(tick, text, score) {
    const hostFrame = Math.ceil(tick / job.source_stride);
    if (hostFrame < job.start || hostFrame >= job.end) return;
    const frame = (hostFrames ? hostFrames[hostFrame - job.start] : hostFrame) - start;
    if (frame >= 0 && frame < end - start) {
      messages.push({frame, text, ...(Number.isSafeInteger(score) ? {score} : {})});
    }
  }
  if (job.feed_events === null) {
    const subject = job.feed_version === 2 && names[job.player_slot] === job.player_name
      && Object.values(names).filter(n => n === job.player_name).length === 1
      ? names[job.player_slot] : null;
    for (const entry of recordedMessages(hostWorld.manifest.replay.events ?? [],
      job.source_start, job.source_end, subject, job.feed_version === 2)) {
      add(entry.tick, entry.text, entry.score);
    }
    return messages;
  }
  for (const event of job.feed_events) {
    const {kind, source_tick: tick, multikill} = event;
    const victim = names[event.victim_slot] || `Player ${event.victim_slot + 1}`;
    const killer = names[event.killer_slot] || (Number.isInteger(event.killer_slot) ? `Player ${event.killer_slot + 1}` : null);
    let text = `${victim} died`;
    if (kind === 'suicide') text = `${victim} committed suicide`;
    if (killer && kind === 'kill') text = `${killer} killed ${victim}`;
    const ownKill = job.feed_version === 2 && kind === 'kill' && event.killer_slot === job.player_slot;
    if (ownKill) text = `You killed ${victim}`;
    if (killer && kind === 'betrayal') text = `${killer} betrayed ${victim}`;
    const score = ownKill ? scores?.get(event) : undefined;
    add(tick, text, score);
    if (multikill >= 2) {
      const award = ['Double Kill!', 'Triple Kill!', 'Killtacular!'][multikill - 2];
      add(tick, award ?? `${multikill}-kill multikill!`, score);
    }
  }
  return messages;
}
