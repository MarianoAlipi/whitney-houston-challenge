import { h, clear, fmtMs, fmtTime } from '../../core/dom.js';
import { runMarkTargetFlow } from '../../game/mark-target.js';
import { setMarkedOverride } from '../../game/targets.js';

const NUDGE_STEP_MS = 10;

// Shared by play.js and party-screen.js: play the source a few times, take
// the earliest hit as the estimate (see game/mark-target.js for why earliest
// rather than median), then let the host nudge it by ear before committing.
export function renderMarkTargetPanel(panelEl, source, preset, onDone) {
  clear(panelEl);
  const takesList = h('ul');
  panelEl.appendChild(h('h2', {}, 'Mark the drop'));
  panelEl.appendChild(
    h(
      'p',
      {},
      "This song hasn't been marked on this device yet. It'll play through a few times, hit your drum right on the drop each time."
    )
  );
  panelEl.appendChild(takesList);

  runMarkTargetFlow(source, {
    seekAt: preset.approxPauseStartSec || 0,
    onTake: ({ index, mediaTime, total }) => {
      takesList.appendChild(
        h('li', {}, `Take ${index + 1} of ${total}: ${mediaTime != null ? fmtTime(mediaTime) : 'no hit detected'}`)
      );
    },
    onDone: ({ best }) => {
      if (best == null) {
        panelEl.appendChild(h('p', {}, 'No hits were detected. Check your controller on the Controller Setup screen, then try again.'));
        panelEl.appendChild(h('button', { class: 'btn', onClick: () => renderMarkTargetPanel(panelEl, source, preset, onDone) }, 'Try again'));
        return;
      }
      renderConfirm(best);
    },
  });

  function renderConfirm(best) {
    let nudgeMs = 0;
    const valueEl = h('strong', { class: 'num' }, fmtTime(best));
    const nudgeLabel = h('span', { class: 'muted num' }, fmtMs(0));

    const applyNudge = (deltaMs) => {
      nudgeMs += deltaMs;
      valueEl.textContent = fmtTime(best + nudgeMs / 1000);
      nudgeLabel.textContent = `nudge: ${fmtMs(nudgeMs)}`;
    };

    panelEl.appendChild(
      h('div', { class: 'card stack' }, [
        h('p', {}, ['Earliest reaction: ', valueEl]),
        h('p', { class: 'muted' }, "If it feels a hair late or early once you play it, nudge it. A reaction is never early, so if anything this should move earlier, not later."),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn', onClick: () => applyNudge(-NUDGE_STEP_MS) }, `− ${NUDGE_STEP_MS}ms`),
          nudgeLabel,
          h('button', { class: 'btn', onClick: () => applyNudge(NUDGE_STEP_MS) }, `+ ${NUDGE_STEP_MS}ms`),
        ]),
        h('div', { class: 'row' }, [
          h(
            'button',
            {
              class: 'btn btn-primary',
              onClick: () => {
                const final = best + nudgeMs / 1000;
                setMarkedOverride(preset.id, final);
                onDone(final);
              },
            },
            'Use this'
          ),
          h('button', { class: 'btn', onClick: () => renderMarkTargetPanel(panelEl, source, preset, onDone) }, 'Redo takes'),
        ]),
      ])
    );
  }
}
