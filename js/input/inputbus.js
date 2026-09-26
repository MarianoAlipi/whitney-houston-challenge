// Integration point: keyboard.js + gamepad.js (+ optional webhid.js) all
// report raw edges here; this resolves them through bindings.js and emits
// the normalized event the rest of the app consumes.
//
//   bus 'input:raw': every edge, pre-resolution (controller-setup UI, debug overlay, capture mode)
//   bus 'input:hit': {device, deviceId, zone, timestamp} once resolved to a known zone
import { bus } from '../core/events.js';
import { startGamepadPolling } from './gamepad.js';
import { startKeyboardListening } from './keyboard.js';
import { startWebHidListening } from './webhid.js';
import { resolveZone, getKeyboardBindings, deviceKeyOf } from './bindings.js';

let started = false;

function handleRaw(raw) {
  bus.emit('input:raw', raw);

  let zone = null;
  if (raw.device === 'webhid') {
    zone = raw.zone;
  } else if (raw.device === 'gamepad') {
    zone = resolveZone(raw.gamepad, raw);
  } else if (raw.device === 'keyboard') {
    zone = getKeyboardBindings()[raw.index] ?? null;
  }
  if (!zone) return;

  // Normalized to VID:PID (not the raw gamepad.id string, which differs by
  // engine) so a calibration profile saved in one browser still resolves
  // correctly in another, see input/bindings.js.
  const deviceId = raw.device === 'gamepad' ? deviceKeyOf(raw.gamepad) : raw.device === 'webhid' ? '0f0d:00f0' : 'keyboard';

  bus.emit('input:hit', { device: raw.device, deviceId, zone, timestamp: raw.timestamp });
}

export function startInputBus() {
  if (started) return;
  started = true;
  startGamepadPolling(handleRaw);
  startKeyboardListening(handleRaw);
  startWebHidListening(handleRaw);
}
