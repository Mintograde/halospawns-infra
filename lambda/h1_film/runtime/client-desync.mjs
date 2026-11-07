// Only a completed, source-bound simulation with an explicit desync verdict may
// lose its client world. Crashes, timeouts, bad inputs and incomplete logs fail.
export class ClientDesync extends Error {
  constructor(evidence, cause) {
    super('Client simulation desynchronized', {cause});
    this.evidence = evidence;
  }
}

export function completedClientDesync(log, envelope) {
  if (/NOT ONE CONTROL PUSH|RECORDED BY ANOTHER BUILD|the gametype is resolved by NAME/.test(log)) return null;
  const played = [...log.matchAll(/\[film\] played (\d+) ticks? of/g)].at(-1);
  const checks = [...log.matchAll(/self-check: (\d+) seed mismatch(?:es)?, (\d+) of (\d+) hash samples? differed, (\d+) control push(?:es)?/g)].at(-1);
  const verdict = [...log.matchAll(/VERDICT: DESYNCED, first at update (\d+)/g)].at(-1);
  const network = [...log.matchAll(/network changes put back: (\d+), (\d+) refused/g)].at(-1);
  if (!played || !checks || !verdict || !network) return null;
  const result = {reason:'simulation_desync', played_ticks:Number(played[1]),
    seed_mismatches:Number(checks[1]), hash_mismatches:Number(checks[2]),
    hash_checks:Number(checks[3]), control_pushes:Number(checks[4]),
    first_mismatch_update:Number(verdict[1]), network_applied:Number(network[1]), network_refused:Number(network[2])};
  if (Object.entries(result).some(([key,n])=>key!=='reason'&&(!Number.isSafeInteger(n)||n<0||n>2147483647))
      || result.played_ticks!==envelope.ticks || result.hash_checks!==envelope.hash_samples
      || !(result.seed_mismatches || result.hash_mismatches) || !result.control_pushes
      || result.seed_mismatches>envelope.ticks || result.hash_mismatches>result.hash_checks
      || result.first_mismatch_update<envelope.first_update
      || result.first_mismatch_update>=envelope.first_update+envelope.ticks
      || result.network_applied+result.network_refused!==envelope.network?.applications) return null;
  return result;
}

export function clientDesyncEvidence(error) {
  for (let e=error;e;e=e.cause) if(e instanceof ClientDesync) return e.evidence;
  return null;
}
