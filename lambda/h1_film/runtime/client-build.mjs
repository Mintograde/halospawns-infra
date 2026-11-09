// Unknown client code must never run under the host's engine identity. The new
// recipe can retain a structurally validated client without claiming playback.
import {matchesProfile} from './build-identity.mjs';

export function unsupportedClientBuild(envelope,profile,revision,rule) {
  if(profile.id!=='h1-performance-beta6-p9839-wasm-v1'||revision<22
    ||envelope.recording_kind!=='client-view'
    ||!['format','protocol_revision','tick_rate'].every(key=>envelope[key]===profile[key])
    ||typeof envelope.build!=='string'||!/^[\x20-\x7e]{1,63}$/.test(envelope.build)
    ||matchesProfile(profile,envelope,rule))return null;
  return {reason:'unsupported_build',recorded_build:envelope.build,
    format:envelope.format,protocol_revision:envelope.protocol_revision,tick_rate:envelope.tick_rate};
}
