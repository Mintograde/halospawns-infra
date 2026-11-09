// Unrecognized clients remain unavailable unless a recipe explicitly admits a
// reviewed recording identity. An exception only selects the pinned engine;
// the unchanged source still has to pass every normal simulation check.
import {matchesProfile} from './build-identity.mjs';

export function compatibleClientBuild(envelope,profile,revision) {
  return Number.isSafeInteger(revision)&&revision>=23
    &&profile.id==='h1-performance-beta6-p9839-wasm-v1'
    &&profile.source?.git_commit==='86c52285a8ebe7d107bfafae64abe722b263cedf'
    &&profile.format===3&&profile.protocol_revision===9839&&profile.tick_rate===120
    &&envelope.recording_kind==='client-view'
    &&envelope.build==='2026-11-08 - ec92e0bb'
    &&['format','protocol_revision','tick_rate'].every(key=>envelope[key]===profile[key]);
}

export function unsupportedClientBuild(envelope,profile,revision,rule) {
  if(profile.id!=='h1-performance-beta6-p9839-wasm-v1'||revision<22
    ||envelope.recording_kind!=='client-view'
    ||!['format','protocol_revision','tick_rate'].every(key=>envelope[key]===profile[key])
    ||typeof envelope.build!=='string'||!/^[\x20-\x7e]{1,63}$/.test(envelope.build)
    ||matchesProfile(profile,envelope,rule)||compatibleClientBuild(envelope,profile,revision))return null;
  return {reason:'unsupported_build',recorded_build:envelope.build,
    format:envelope.format,protocol_revision:envelope.protocol_revision,tick_rate:envelope.tick_rate};
}
