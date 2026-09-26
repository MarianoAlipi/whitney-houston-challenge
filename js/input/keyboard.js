// Keyboard fallback (testing without a drum, or a spare "hit" key for a
// simultaneous-mode player who doesn't have a controller). event.timeStamp
// is a DOMHighResTimeStamp in the performance.now() time origin, stamped
// when the browser creates the event from the OS input: the most accurate
// timestamp the platform offers for this.
import { getKeyboardBindings } from './bindings.js';

let onRaw = null;
let listening = false;

function isTypingTarget() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function onKeyDown(e) {
  if (e.repeat || isTypingTarget()) return;
  // Only act on keys actually bound to something. Space/arrow keys scroll
  // the page by default, which fights with using them as a hit button. Only
  // suppress that default for keys the player has actually bound, so an
  // unrelated key (or a rebind away from Space) doesn't lose its normal
  // browser behavior for no reason.
  if (!(e.code in getKeyboardBindings())) return;
  e.preventDefault();
  onRaw?.({ device: 'keyboard', kind: 'key', index: e.code, timestamp: e.timeStamp });
}

export function startKeyboardListening(reportRaw) {
  onRaw = reportRaw;
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', onKeyDown);
}

export function stopKeyboardListening() {
  window.removeEventListener('keydown', onKeyDown);
  listening = false;
}
