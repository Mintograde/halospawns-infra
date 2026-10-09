// Called only with a worker-owned local file, before starting the simulator.
import { readEnvelope } from './film.mjs';
import { selectProfile } from './profiles.mjs';

let envelope;
try {
  if (process.argv.length !== 3) throw new Error('Expected one film');
  envelope = await readEnvelope(process.argv[2]);
} catch {
  console.log(JSON.stringify({ error: 'validation_failed' }));
  process.exit(1);
}
try {
  const profile = selectProfile(envelope);
  console.log(JSON.stringify({ envelope, profile: profile.id }));
} catch {
  console.log(JSON.stringify({ error: 'unsupported_build' }));
  process.exitCode = 1;
}
