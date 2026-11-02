// Called only with a worker-owned local file, before starting the simulator.
import { readEnvelope } from './film.mjs';
import { selectProfile } from './profiles.mjs';
import { inspectViewRecording } from './client-view-evidence.mjs';

let envelope;
try {
  if (process.argv.length !== 3) throw new Error('Expected one film');
  envelope = await readEnvelope(process.argv[2], {allowClientView:true});
} catch {
  console.log(JSON.stringify({ error: 'validation_failed' }));
  process.exit(1);
}
try {
  const profile = selectProfile(envelope);
  let intake;
  if (profile.id === 'h1-performance-beta5-p9818-wasm-v1') {
    const observed = await inspectViewRecording(process.argv[2], {allowUnmatchedHost:true});
    intake = Object.fromEntries(['recording_role', 'match_id', 'recorded_own_player', 'first_update']
      .map(key => [key, observed[key]]));
    intake.clock_recorded_own_player = observed.alignment_rows?.length
      ? observed.diagnostic_recorded_own_player : null;
  }
  // Network clocks can be large; only the bounded intake identity belongs in this log.
  const {network, ...header} = envelope;
  console.log(JSON.stringify({ envelope: {...header, ...(network ? {network:{
    participant_count:network.participant_count, roster_recovery:network.roster_recovery}} : {})},
    profile: profile.id, ...(intake ? {intake} : {}) }));
} catch {
  console.log(JSON.stringify({ error: 'unsupported_build' }));
  process.exitCode = 1;
}
