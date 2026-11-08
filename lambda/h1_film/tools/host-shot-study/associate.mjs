// Offline estimates only. Never import this adapter from a conversion/publishing path.
// Client accounts are deliberately unavailable to the candidate: they are the oracle.
export const configs = [
  {name:'time_previous_12', window:12, mode:'previous'},
  {name:'time_nearest_12', window:12, mode:'nearest'},
  {name:'ray_previous_12', window:12, mode:'previous', ray:true},
  {name:'collision_previous_12', window:12, mode:'previous', collision:true},
  {name:'ray_collision_previous_12', window:12, mode:'previous', ray:true, collision:true},
];

const norm = v => v?.length === 3 && v.every(Number.isFinite) ? Math.hypot(...v) : NaN;
function rayMatches(round, deal) {
  const size = norm(round.direction), other = norm(deal.direction);
  if (!(size > 0 && other > 0) || !Number.isFinite(norm(round.origin))
    || !Number.isFinite(norm(deal.impact))) return false;
  const direction = round.direction.map(v => v / size);
  const delta = deal.impact.map((v,i) => v - round.origin[i]);
  const along = delta.reduce((n,v,i) => n + v * direction[i], 0);
  const distance = Math.hypot(...delta.map((v,i) => v - along * direction[i]));
  const cosine = direction.reduce((n,v,i) => n + v * deal.direction[i] / other, 0);
  return along >= -0.05 && distance <= 0.25 && cosine >= Math.cos(3 * Math.PI / 180);
}

export function associateHostShots(events, geometry, config) {
  const shots = new Map(), sequences = new Map(), rounds = new Map();
  const collisions = new Map(), deals = new Map();
  for (const g of geometry) {
    if (g.event === 'round') {
      const list = rounds.get(g.shot) ?? []; list.push(g); rounds.set(g.shot,list);
    }
    if (g.event === 'collision') {
      const list = collisions.get(g.shot) ?? []; list.push(g); collisions.set(g.shot,list);
    }
    if (g.event === 'deal') deals.set(g.deal,g);
  }
  for (const e of events) if (e.kind === 0) {
    const sequence = (sequences.get(e.slot) ?? 0) + 1;
    sequences.set(e.slot,sequence);
    const list = shots.get(e.slot) ?? [];
    list.push({...e,sequence,domain:'host-estimate',discharge:'host-estimate/' + e.shot});
    shots.set(e.slot,list);
  }
  const mapped = new Map(), used = new Set(), associations = [];
  const result = events.map(e => {
    if (e.kind === 0) return {...e,discharge:'local/' + e.shot,domain:'local'};
    if (e.kind !== 1) return e;
    if (!e.deal) return {...e,discharge:e.shot ? 'local/' + e.shot : null};
    if (!mapped.has(e.deal)) {
      const candidates = (shots.get(e.slot) ?? []).filter(s =>
        s.weapon_tag === e.weapon_tag && s.physical === e.physical
        && (config.mode === 'previous'
          ? e.clock - s.clock >= 0 && e.clock - s.clock <= config.window
          : Math.abs(e.clock - s.clock) <= config.window));
      // Geometry may reject a unique temporal match, never select among several.
      let best = candidates.length === 1 ? candidates[0] : null;
      if (best && used.has(best.discharge)) best = null;
      if (best && config.collision
        && !(collisions.get(best.shot) ?? []).some(c => c.object === e.unit)) best = null;
      if (best && config.ray) {
        const deal = deals.get(e.deal);
        if (!deal || !(rounds.get(best.shot) ?? []).some(r => rayMatches(r,deal))) best = null;
      }
      mapped.set(e.deal,best);
      if (best) {
        used.add(best.discharge);
        associations.push({deal:e.deal,shot:best.shot,slot:e.slot,
          host_fire_tick:best.clock,damage_tick:e.clock,source_tick:e.source_tick});
      }
    }
    const shot = mapped.get(e.deal);
    return {...e,discharge:shot?.discharge ?? null,remoteShot:shot ?? undefined};
  });
  return {events:result,associations};
}
