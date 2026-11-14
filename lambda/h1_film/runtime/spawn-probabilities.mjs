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
export const NEUTRAL_THRESHOLD = Object.freeze({positive_to_neutral_ratio_exclusive: 2});

// Ratings are the engine's final net influence: 1 is neutral, >1 positive,
// and 0<rating<1 negative. Use an actual neutral candidate, never insert one.
export function classifyNeutralSpawn(ratings, chosenIndex) {
  const probabilities = spawnProbabilities(ratings);
  const result = classifyProbabilities(ratings, chosenIndex, INITIAL_THRESHOLD, probabilities);
  if (result === null) return null;
  const neutralIndex = ratings.indexOf(1);
  const neutral = neutralIndex < 0 ? null : probabilities[neutralIndex];
  const positive = ratings.some(r => r > 1) ? result.highest_probability : null;
  const rating = ratings[chosenIndex];
  const threshold = neutral === null ? null : 2 * neutral;
  return {
    ...result,
    chosen_rating: rating,
    neutral_probability: neutral,
    highest_positive_probability: positive,
    improbable: neutral !== null && positive !== null &&
      (rating === 1 || (rating < 1 && result.chosen_probability < neutral)) &&
      positive > threshold && positive - threshold > 1e-12 * Math.max(positive, threshold),
  };
}

export function classifySpawn(ratings, chosenIndex, threshold = INITIAL_THRESHOLD) {
  return classifyProbabilities(ratings, chosenIndex, threshold, spawnProbabilities(ratings));
}

function classifyProbabilities(ratings, chosenIndex, threshold, probabilities) {
  if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= ratings.length) {
    throw new RangeError('Chosen spawn index is outside the rating array');
  }
  const {maximum_ratio: ratio, minimum_gap: gap} = threshold;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio >= 1 ||
      !Number.isFinite(gap) || gap < 0 || gap > 1) {
    throw new RangeError('Invalid improbable-spawn threshold');
  }
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
