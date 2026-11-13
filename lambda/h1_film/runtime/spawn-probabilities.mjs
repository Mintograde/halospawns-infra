// Continuous independent-uniform model of argmax(rating * sqrt(U)).
// Input must be the ratings observed by the actual selection loop, before RNG.
// Model v1 deliberately does not claim exact finite, correlated PRNG odds.
export function spawnProbabilities(ratings) {
  if (!Array.isArray(ratings) || !ratings.length ||
      ratings.some(r => typeof r !== 'number' || !Number.isFinite(r))) {
    throw new TypeError('Expected a nonempty array of finite spawn ratings');
  }
  const maximum = ratings.reduce((m, r) => Math.max(m, r), 0);
  if (maximum === 0) return null; // No positive score can win.
  const weights = ratings.map(r => r > 0 ? (r / maximum) ** 2 : 0);
  if (ratings.some((r, i) => r > 0 && weights[i] === 0)) {
    throw new RangeError('Spawn rating dynamic range exceeds probability precision');
  }
  const ordered = weights.map((w, i) => ({w, i})).filter(x => x.w > 0)
    .sort((a, b) => a.w - b.w);
  const probabilities = ratings.map(() => 0);
  let integral = 0;
  let previous = 0;
  // On each interval F(t)=product(min(1,t/w)); integrate F(t)/t.
  // Log products avoid overflow and underflow from multiplying raw weights.
  const suffixLogs = new Array(ordered.length + 1).fill(0);
  for (let k = ordered.length - 1; k >= 0; k--) {
    suffixLogs[k] = suffixLogs[k + 1] + Math.log(ordered[k].w);
  }
  for (let k = 0; k < ordered.length; k++) {
    const {w, i} = ordered[k];
    const active = ordered.length - k;
    const logF = Math.min(0, active * Math.log(w) - suffixLogs[k]);
    const fraction = previous === 0 ? 1 : -Math.expm1(active * Math.log(previous / w));
    integral += Math.exp(logF) * fraction / active;
    probabilities[i] = integral;
    previous = w;
  }
  return probabilities.map(p => Math.min(1, Math.max(0, p)));
}

export const INITIAL_THRESHOLD = Object.freeze({maximum_ratio: 0.5, minimum_gap: 0.10});

export function classifySpawn(ratings, chosenIndex, threshold = INITIAL_THRESHOLD) {
  if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= ratings.length) {
    throw new RangeError('Chosen spawn index is outside the rating array');
  }
  const {maximum_ratio: ratio, minimum_gap: gap} = threshold;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio >= 1 ||
      !Number.isFinite(gap) || gap < 0 || gap > 1) {
    throw new RangeError('Invalid improbable-spawn threshold');
  }
  const probabilities = spawnProbabilities(ratings);
  if (!probabilities || ratings[chosenIndex] <= 0) return null;
  const chosen = probabilities[chosenIndex];
  const highest = probabilities.reduce((m, p) => Math.max(m, p), 0);
  const tolerance = 1e-12;
  return {
    chosen_probability: chosen,
    highest_probability: highest,
    probability_ratio: chosen / highest,
    probability_gap: highest - chosen,
    non_highest: chosen < highest - tolerance,
    improbable: chosen < highest - tolerance && chosen <= highest * ratio + tolerance &&
      highest - chosen >= gap - tolerance,
  };
}
