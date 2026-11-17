// Rates implemented by each pinned upstream source, independent of its default.
// Beta 3 and the retained arena snapshot have no runtime rate switch.
const SWITCHABLE = new Set([9803, 9818, 9839, 9844, 9848]);
export const TICK_RATE_EXPORTER = 40;
export const TICK_RATE_CONTRACT = 'halospawns.h1TickRates.v1';

export function supportedTickRates(profile) {
  return SWITCHABLE.has(profile.protocol_revision) ? [30, 120] : [120];
}

export function supportsTickRate(profile, rate) {
  return Number.isInteger(rate) && supportedTickRates(profile).includes(rate);
}

export function sourceRateKey(rate) { return rate === 120 ? '120hz' : 'source'; }
export function sourceReplayName(rate) { return `replay.${sourceRateKey(rate)}.hsrdc`; }
export function analyticsStride(rate) {
  if (![30, 120].includes(rate)) throw new Error('Unsupported film tick rate');
  return rate / 30;
}
