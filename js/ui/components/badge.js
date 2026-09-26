import { h } from '../../core/dom.js';

// Kept to one short word: the dots already carry the high/medium/low level,
// the fuller explanation ("uncalibrated or unstable, treat as a rough
// number") was too verbose for what's meant to be a quiet, out-of-the-way
// pill. Hover/title gives the longer version to anyone who wants it.
const SHORT_LABEL = { HIGH: 'Verified', MEDIUM: 'Calibrated', LOW: 'Uncalibrated' };
const TITLE = {
  HIGH: 'Target marked on this system, offsets cancel',
  MEDIUM: 'Shipped preset, calibrated',
  LOW: 'Uncalibrated or unstable, treat as a rough number',
};

export function renderConfidenceBadge(confidence) {
  return h('div', { class: `confidence ${confidence.toLowerCase()}`, title: TITLE[confidence] ?? '' }, [
    h('span', { class: 'dots' }, [h('span'), h('span'), h('span')]),
    h('span', {}, SHORT_LABEL[confidence] ?? confidence),
  ]);
}
