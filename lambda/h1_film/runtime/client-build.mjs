// Unrecognized clients remain unavailable unless a recipe explicitly admits a
// reviewed recording identity. An exception only selects the pinned engine;
// the unchanged source still has to pass every normal simulation check.
import {matchesProfile} from './build-identity.mjs';

export const EMPTY_CLIENT_BUILD_EXPORTER = 47;
const BETA8_PROFILE = 'h1-performance-beta8-p9848-wasm-v1';
const BETA8_SOURCE = '3194e680896cead7326c2a3fcb9e35e85de1d7cc';

// A zero-filled recorder label contains no source identity. Only the enclosing,
// already verified host can supply an engine to try for this embedded world.
export function hostForEmptyClientBuild(report, host, player) {
  if (!Number.isSafeInteger(report.exporter_revision) || report.exporter_revision < EMPTY_CLIENT_BUILD_EXPORTER
      || report.engine_profile !== BETA8_PROFILE
      || report.provenance.engine_source?.git_commit !== BETA8_SOURCE || !(report.simulation?.hash_checks > 0)
      || host.format !== 3 || host.protocol_revision !== 9848 || host.tick_rate !== 30
      || !Number.isInteger(player) || player < 0 || player > 15
      || !/^[0-9a-f]{16}$/.test(host.match_id) || host.match_id === '0000000000000000') return undefined;
  return {match_id:host.match_id, map:host.map, player};
}

export function matchesEmptyClientBuild(envelope, profile, playback) {
  const host = playback.verifiedClientHost;
  return Boolean(host && playback.embeddedClient === true && Number.isSafeInteger(playback.exporterRevision)
    && playback.exporterRevision >= EMPTY_CLIENT_BUILD_EXPORTER && profile.id === BETA8_PROFILE
    && profile.source?.git_commit === BETA8_SOURCE && envelope.recording_kind === 'client-view'
    && envelope.build === '' && envelope.format === profile.format && envelope.protocol_revision === profile.protocol_revision
    && envelope.tick_rate === 30 && envelope.map === host.map && envelope.match_id === host.match_id
    && envelope.recorded_own_player === host.player && (envelope.recorded_local_player_mask & (1 << host.player))
    && envelope.hash_samples > 0);
}

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
  if(!['h1-performance-beta6-p9839-wasm-v1','h1-performance-beta7-p9844-wasm-v1', 'h1-performance-beta8-p9848-wasm-v1'].includes(profile.id)||revision<22
    ||envelope.recording_kind!=='client-view'
    ||!['format','protocol_revision','tick_rate'].every(key=>envelope[key]===profile[key])
    ||typeof envelope.build!=='string'||!/^[\x20-\x7e]{1,63}$/.test(envelope.build)
    ||matchesProfile(profile,envelope,rule)||compatibleClientBuild(envelope,profile,revision))return null;
  return {reason:'unsupported_build',recorded_build:envelope.build,
    format:envelope.format,protocol_revision:envelope.protocol_revision,tick_rate:envelope.tick_rate};
}
