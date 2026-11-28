// Slayer applies the same adjustment to the scorer and their team. A stable
// roster lets the recorded individual scoreboard recover the exact team total.
function scoreboard(tick, slot, stablePlayerCount) {
  const players = tick?.players;
  if (tick?.game_type !== 2 || !Array.isArray(players)) return null;
  const subject = players.find(p => p.player_index === slot);
  if (!Number.isInteger(subject?.score)) return null;
  if (tick.game_engine_has_teams === false) return {score:subject.score, slots:new Set([slot])};
  if (tick.game_engine_has_teams !== true || players.length !== stablePlayerCount
      || !players.every(p => Number.isInteger(p.team) && p.team >= 0 && Number.isInteger(p.player_index))
      || new Set(players.map(p => p.player_index)).size !== players.length) return null;
  const team = players.filter(p => p.team === subject.team);
  if (!team.every(p => Number.isInteger(p.score))) return null;
  return {score:team.reduce((sum,p) => sum + p.score,0), slots:new Set(team.map(p => p.player_index))};
}

export async function clipKillScores(job, readHostTick) {
  const scores = new Map(), groups = new Map(), slot = job.player_slot;
  const ownKill = event => event.kind === 'kill' && event.killer_slot === slot;
  for (const event of job.feed_events ?? []) {
    const frame = Math.ceil(event.source_tick / job.source_stride);
    if (frame < job.start || frame >= job.end) continue;
    if (!groups.has(frame)) groups.set(frame, []);
    groups.get(frame).push(event);
  }
  for (const [frame, events] of groups) {
    if (!events.some(ownKill)) continue;
    const before = events.length > 1 && frame > 0
      ? scoreboard(await readHostTick(frame - 1), slot, job.stable_player_count) : null;
    const after = scoreboard(await readHostTick(frame), slot, job.stable_player_count);
    if (!after) continue;
    const side = events.filter(e => after.slots.has(e.killer_slot ?? e.victim_slot));
    // Multiple kills can land on one recorded frame. Each clean Slayer kill
    // scores at most one. Only assign intermediate points proven by the delta.
    const delta = before ? after.score - before.score : null;
    const clean = side.every(e => e.kind === 'kill');
    for (const [index, event] of side.entries()) {
      if (!ownKill(event)) continue;
      if (index === side.length - 1 || (clean && delta === 0)) scores.set(event, after.score);
      else if (clean && delta === side.length) scores.set(event, before.score + index + 1);
    }
  }
  return scores;
}
