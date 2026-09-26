// Toggle with the backtick key. Shows exactly the numbers the plan's
// verification section calls for: clock residuals, sample cadence, gamepad
// state, and the Firefox/macOS warning, enough to tell "the anchor logic is
// wrong" apart from "this hardware/browser combination is just noisy".
import { bus } from '../../core/events.js';
import { getAudioContext } from '../../core/clock.js';
import { listConnectedGamepads, isFirefoxOnMac } from '../../input/gamepad.js';

let el = null;
let visible = false;
const recentRaw = [];

export function mountDebugOverlay() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'debug-overlay';
  el.className = 'hidden';
  document.body.appendChild(el);

  window.addEventListener('keydown', (e) => {
    if (e.key === '`') {
      visible = !visible;
      el.className = visible ? '' : 'hidden';
    }
  });

  bus.on('input:raw', (raw) => {
    const extra = raw.delta !== undefined ? ` Δ${raw.delta.toFixed(2)}` : '';
    recentRaw.unshift(`${raw.device} ${raw.kind}#${raw.index}${extra} @${raw.timestamp.toFixed(1)}ms`);
    if (recentRaw.length > 6) recentRaw.length = 6;
  });

  const loop = () => {
    if (visible) render();
    requestAnimationFrame(loop);
  };
  loop();
}

function render() {
  const ctx = getAudioContext();
  const pads = listConnectedGamepads();
  el.innerHTML = [
    '<strong>debug</strong> (` to toggle)',
    `audio: state=${ctx.state} rate=${ctx.sampleRate} base=${((ctx.baseLatency || 0) * 1000).toFixed(1)}ms out=${((ctx.outputLatency || 0) * 1000).toFixed(1)}ms`,
    `gamepads: ${pads.length ? pads.map((p) => `${p.id} (${p.buttons.length}b/${p.axes.length}a, "${p.mapping}")`).join(', ') : 'none'}`,
    `firefox+macOS warning: ${isFirefoxOnMac() ? 'YES, expect ~25ms extra input delay' : 'no'}`,
    'recent input:',
    ...recentRaw,
  ].join('<br>');
}
