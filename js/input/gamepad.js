// Gamepad polling. Deliberately NOT driven by requestAnimationFrame:
// navigator.getGamepads() re-samples shared memory on every call (Blink is
// not caching per frame), and Chrome's own backend refreshes at 4ms/250Hz,
// so polling in rAF (~16.7ms) throws away real freshness for no reason.
// A dedicated fast interval gets us close to that 4ms floor; the browser
// will clamp the interval near there anyway, which is fine, since that's
// the actual hardware-adjacent refresh rate.
//
// Judge off gp.timestamp when it's usable (Chrome/Safari: HID report arrival
// time, same origin as performance.now()) rather than the poll tick itself,
// see input/inputbus.js. Firefox's gamepad.timestamp is NOT the arrival time
// (it's stamped when Firefox updates the JS object), so it's ignored there
// via the `> 0` guard everywhere this timestamp is read downstream. Firefox
// does report a valid positive number, just not the useful one, so instead
// we accept the small extra jitter rather than trying to detect the engine.
import { bus } from '../core/events.js';

const POLL_MS = 2;
const AXIS_THRESHOLD = 0.5;
const REFRACTORY_MS = 10;
const STABLE_WINDOW = 12;
const STABLE_EPSILON = 0.02;

const states = new Map(); // gp.index -> state
let pollTimer = null;
let onRaw = null;
let captureMode = false;

export function setCaptureMode(enabled) {
  captureMode = enabled;
}
export function isCaptureMode() {
  return captureMode;
}

export function isFirefoxOnMac() {
  const ua = navigator.userAgent;
  return /Firefox/.test(ua) && /Macintosh/.test(ua);
}

function freshState(gp) {
  return {
    prevButtons: gp.buttons.map((b) => b.pressed),
    axisBaseline: gp.axes.slice(),
    axisWindow: [],
    axisArmed: gp.axes.map(() => false),
    lastEdgeAt: new Map(),
  };
}

function withinRefractory(state, key, now) {
  const last = state.lastEdgeAt.get(key);
  if (last !== undefined && now - last < REFRACTORY_MS) return true;
  state.lastEdgeAt.set(key, now);
  return false;
}

// Never assumes rest = 0: the D-pad hat on this device rests at ~+1.286
// (logical null 8 normalized over a 0-7 range), so we learn whatever the
// device actually reports at idle instead of hardcoding zero.
function updateBaseline(state, gp, anyPressed) {
  state.axisWindow.push(gp.axes.slice());
  if (state.axisWindow.length > STABLE_WINDOW) state.axisWindow.shift();
  if (anyPressed || state.axisWindow.length < STABLE_WINDOW) return;
  const first = state.axisWindow[0];
  const stable = first.every((v, i) => state.axisWindow.every((frame) => Math.abs(frame[i] - v) <= STABLE_EPSILON));
  if (stable) state.axisBaseline = first.slice();
}

function poll() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    let state = states.get(gp.index);
    if (!state) {
      state = freshState(gp);
      states.set(gp.index, state);
    }
    const now = performance.now();
    let anyPressed = false;

    gp.buttons.forEach((b, i) => {
      const pressed = b.pressed || b.value > 0.5;
      if (pressed) anyPressed = true;
      if (pressed && !state.prevButtons[i] && !withinRefractory(state, `button:${i}`, now)) {
        const timestamp = gp.timestamp > 0 ? gp.timestamp : now;
        onRaw?.({ device: 'gamepad', gamepadIndex: gp.index, gamepadId: gp.id, gamepad: gp, kind: 'button', index: i, timestamp });
      }
      state.prevButtons[i] = pressed;
    });

    // Cheap enough to always evaluate; only crosses the threshold for a
    // profile that actually has an axis binding (e.g. a clone controller).
    gp.axes.forEach((v, i) => {
      const rest = state.axisBaseline[i] ?? 0;
      const delta = v - rest;
      const active = Math.abs(delta) > AXIS_THRESHOLD;
      if (active && !state.axisArmed[i] && !withinRefractory(state, `axis:${i}`, now)) {
        onRaw?.({ device: 'gamepad', gamepadIndex: gp.index, gamepadId: gp.id, gamepad: gp, kind: 'axis', index: i, delta, timestamp: now });
      }
      state.axisArmed[i] = active;
    });

    updateBaseline(state, gp, anyPressed);
  }
}

function handleDisconnect(e) {
  states.delete(e.gamepad.index);
  bus.emit('input:gamepaddisconnected', { gamepad: e.gamepad });
}
function handleConnect(e) {
  bus.emit('input:gamepadconnected', { gamepad: e.gamepad });
}

export function startGamepadPolling(reportRaw) {
  onRaw = reportRaw;
  if (pollTimer) return;
  pollTimer = setInterval(poll, POLL_MS);
  window.addEventListener('gamepadconnected', handleConnect);
  window.addEventListener('gamepaddisconnected', handleDisconnect);
}

export function stopGamepadPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  window.removeEventListener('gamepadconnected', handleConnect);
  window.removeEventListener('gamepaddisconnected', handleDisconnect);
}

export function listConnectedGamepads() {
  return (navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean);
}
