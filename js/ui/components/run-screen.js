// Renders ONLY the chrome around a round (run-up strip, approach indicator,
// result panel) into `chromeEl`. Deliberately does not touch the video
// element's DOM node at all. The caller owns a fixed video wrapper for the
// whole session. See sources/source.js: reparenting a live <iframe> between
// DOM subtrees (even briefly detaching it) causes browsers to reload it,
// which would silently reset YouTube playback between attempts/turns.
import { h, clear, fmtSeconds, fmtBeats } from '../../core/dom.js';
import { bus } from '../../core/events.js';
import { renderConfidenceBadge } from './badge.js';
import { SONG_BPM } from '../../game/judge.js';

// Only the last fifth of the approach ramps up, so the glow reads as
// building tension right before the drop rather than a slow, ambiguous
// 20-30 second drift that either goes unnoticed or gives the moment away
// too early.
const ANTICIPATION_RAMP_START = 0.8;

export function mountRunScreen(chromeEl, { round, playerLabel, attemptLabel, showCountdown = true, anticipationGlow = true, onComplete }) {
  const cleanupFns = [];

  function renderRunning() {
    clear(chromeEl);
    const strip = h('div', { class: 'run-strip' }, [
      h('span', {}, [h('span', { class: 'player-name' }, playerLabel), attemptLabel ? ` · ${attemptLabel}` : '']),
      h('span', { class: 'muted' }, 'listening…'),
    ]);
    const listenState = h('div', { class: 'listen-state' }, round.showApproach ? 'get ready' : 'listen');
    const approachFill = round.showApproach ? h('div', { class: 'approach-fill' }) : null;
    const approach = round.showApproach ? h('div', { class: 'approach' }, [approachFill]) : null;
    const glow = round.showApproach && anticipationGlow ? h('div', { class: 'anticipation-glow' }) : null;
    const stack = h('div', { class: 'stack' }, [strip, listenState, approach]);

    // The glow is absolutely positioned, so it needs a positioned ancestor
    // scoped to just this screen rather than sizing against whatever
    // ancestor up the tree happens to be positioned (chromeEl itself is
    // owned by the caller and shared with the result view, so wrap locally
    // rather than reaching up to style it).
    chromeEl.appendChild(glow ? h('div', { style: 'position:relative' }, [glow, stack]) : stack);

    const offProgress = bus.on('round:progress', ({ ready, fraction, secondsToDrop }) => {
      if (!ready) {
        listenState.textContent = 'syncing…';
        return;
      }
      if (approachFill) approachFill.style.width = `${Math.round(fraction * 100)}%`;
      if (glow) {
        const intensity = Math.max(0, Math.min(1, (fraction - ANTICIPATION_RAMP_START) / (1 - ANTICIPATION_RAMP_START)));
        glow.style.opacity = String(intensity);
      }
      if (showCountdown) listenState.textContent = secondsToDrop > 0.05 ? `${secondsToDrop.toFixed(1)}s…` : 'now';
    });
    const offResult = bus.on('round:result', (result) => {
      offProgress();
      offResult();
      renderResult(result);
    });
    cleanupFns.push(offProgress, offResult);
  }

  function renderResult(result) {
    clear(chromeEl);
    const tierColor = `var(--tier-${result.color ?? 'miss'})`;

    if (result.noHit) {
      chromeEl.appendChild(
        h('div', { class: 'result-screen' }, [
          h('div', { class: 'hit-flash', style: `background: radial-gradient(circle, ${tierColor} 0%, transparent 65%)` }),
          h('div', { class: 'result-ms', style: `color: ${tierColor}` }, '-'),
          h('div', { class: 'result-direction' }, 'no hit detected'),
          h('div', { class: 'result-grade', style: `color: ${tierColor}` }, result.grade),
          h('div', { class: 'result-subtitle' }, result.subtitle),
          renderConfidenceBadge(result.confidence),
          h('button', { class: 'btn btn-primary btn-lg', style: 'margin-top:2rem', onClick: () => onComplete?.(result) }, 'Continue'),
        ])
      );
      return;
    }
    const pct = 50 + Math.max(-50, Math.min(50, (result.errorMs / 3200) * 50));
    const bar = h('div', { class: 'timing-bar' }, [h('div', { class: 'center-tick' }), h('div', { class: 'marker', style: `left:${pct}%` })]);

    chromeEl.appendChild(
      h('div', { class: 'result-screen' }, [
        h('div', { class: 'hit-flash', style: `background: radial-gradient(circle, ${tierColor} 0%, transparent 65%)` }),
        h('div', { class: 'result-ms', style: `color: ${tierColor}` }, fmtSeconds(result.errorMs)),
        h('div', { class: 'result-beats muted num' }, fmtBeats(result.errorMs, SONG_BPM)),
        h('div', { class: 'result-direction' }, result.errorMs === 0 ? 'dead on' : result.early ? 'early' : 'late'),
        h('div', { class: 'result-grade', style: `color: ${tierColor}` }, result.grade),
        h('div', { class: 'result-subtitle' }, result.subtitle),
        bar,
        renderConfidenceBadge(result.confidence),
        h('button', { class: 'btn btn-primary btn-lg', style: 'margin-top:2rem', onClick: () => onComplete?.(result) }, 'Continue'),
      ])
    );
  }

  renderRunning();
  return () => cleanupFns.forEach((fn) => fn());
}
