// Pure scoring functions, no state, easy to unit-test independently of
// audio/input hardware (see the synthetic end-to-end test in the README).
//
// Tiers are deliberately wide: most real attempts, especially from casual
// players at a party, land well outside a rhythm-game-tight ±250ms window,
// and lumping all of that under one flat "MISS" makes every non-expert
// attempt feel the same and kills the fun. Each tier still gets a real
// color and a line with some personality, not just a number.
export const GRADE_TIERS = [
  { grade: 'WHITNEY', max: 50, color: 'gold', subtitle: 'Note. Perfect.' },
  { grade: 'AMAZING', max: 150, color: 'amazing', subtitle: 'Almost too good.' },
  { grade: 'GREAT', max: 350, color: 'great', subtitle: 'Right on it.' },
  { grade: 'GOOD', max: 700, color: 'good', subtitle: 'Solid hit.' },
  { grade: 'OK', max: 1500, color: 'ok', subtitle: 'Got there.' },
  { grade: 'CLOSE', max: 3000, color: 'close', subtitle: 'So close, go again.' },
];
export const MISS_TIER = { grade: 'MISS', color: 'miss', subtitle: 'Everyone misses one, try again.' };

// Governs both this file's own MISS fallback and how far outside the drop a
// hit is even considered (round.js / simultaneous-round.js): a smidge beyond
// the widest tier's max so CLOSE's own edge isn't clipped by the accept gate.
export const ACCEPT_WINDOW_SEC = 3.2;

// Whitney Houston's "I Will Always Love You" is commonly listed at 134 BPM
// (also reported as 68 BPM half-time by some detectors, same pulse, coarser
// grid). Used only for the secondary "beats early/late" readout; correcting
// it later, if it turns out wrong by ear, is this one line.
export const SONG_BPM = 134;

export function judge(errorMs) {
  const absMs = Math.abs(errorMs);
  const early = errorMs < 0;
  const tier = GRADE_TIERS.find((t) => absMs <= t.max) ?? MISS_TIER;
  return { grade: tier.grade, color: tier.color, subtitle: tier.subtitle, absMs, early, errorMs };
}

export function gradeInfo(grade) {
  return GRADE_TIERS.find((t) => t.grade === grade) ?? MISS_TIER;
}

// HIGH:   target marked on this system (offsets cancel, see the plan) + calibration passed
// MEDIUM: shipped/verified preset + calibration passed
// LOW:    no calibration, calibration gate failed, Firefox/macOS detected, or clock instability
export function computeConfidence({ targetMarked, calibrationPassed, browserWarning, clockStable }) {
  if (browserWarning || !clockStable || !calibrationPassed) return 'LOW';
  return targetMarked ? 'HIGH' : 'MEDIUM';
}
