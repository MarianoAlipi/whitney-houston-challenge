// Controller mapping: persistence, the shipped Taiko default, and the
// capture-mode confirmation protocol used by the remap UI.
//
// The drum's `gamepad.id` differs per engine (Chrome: "Taiko Controller
// (Vendor: 0f0d Product: 00f0)", Firefox: "0f0d-00f0-Taiko Controller",
// Safari: "f0d-f0-Taiko Controller", no zero-padding). We normalize to
// VID:PID and additionally fingerprint the buttons/axes layout, because
// Chrome/Firefox/Safari disagree about axis indexing for the *same* device.
import * as store from '../core/store.js';

export const ZONES = ['ka-left', 'ka-right', 'don-left', 'don-right'];

const TAIKO_VID = '0f0d';
const TAIKO_PID = '00f0';
// Verified three ways (DonCon2040's getSwitchReport(), SDL_GameControllerDB's
// PS4-sibling entry, and the HID rule Button usage N -> bit N-1). Stable
// across Chrome/Edge/Firefox/Safari on both Windows and macOS.
const DEFAULT_TAIKO_BUTTONS = { 6: 'ka-left', 7: 'ka-right', 10: 'don-left', 11: 'don-right' };

export function parseGamepadId(id = '') {
  let m = /Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})/i.exec(id);
  if (m) return { vid: m[1].toLowerCase().padStart(4, '0'), pid: m[2].toLowerCase().padStart(4, '0'), name: id.split(' (')[0].trim() };
  m = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.*)$/i.exec(id);
  if (m) return { vid: m[1].toLowerCase().padStart(4, '0'), pid: m[2].toLowerCase().padStart(4, '0'), name: m[3] };
  return { vid: null, pid: null, name: id };
}

export function deviceKeyOf(gamepad) {
  const { vid, pid, name } = parseGamepadId(gamepad.id);
  return vid && pid ? `${vid}:${pid}` : `raw:${name}`;
}

export function profileKey(gamepad) {
  const layout = `${gamepad.buttons.length}b${gamepad.axes.length}a`;
  return `${deviceKeyOf(gamepad)}|${layout}|${gamepad.mapping || 'none'}`;
}

function loadAllProfiles() {
  return store.get('input:profiles', {});
}
function saveAllProfiles(profiles) {
  store.set('input:profiles', profiles);
}

// Resolution order: exact (device+layout+mapping) match -> looser device-only
// match (e.g. set up on Chrome/Windows, now on Safari/macOS where axis
// indices differ) -> the shipped Taiko default -> null (unbound / unknown device).
export function getProfile(gamepad) {
  const profiles = loadAllProfiles();
  const exact = profiles[profileKey(gamepad)];
  if (exact) return exact;

  const deviceKey = deviceKeyOf(gamepad);
  const loose = Object.values(profiles).find((p) => p.deviceKey === deviceKey);
  if (loose) return loose;

  if (deviceKey === `${TAIKO_VID}:${TAIKO_PID}`) {
    return { deviceKey, bindings: { button: { ...DEFAULT_TAIKO_BUTTONS }, axis: {} }, builtIn: true };
  }
  return null;
}

export function saveProfile(gamepad, bindings) {
  const key = profileKey(gamepad);
  const profiles = loadAllProfiles();
  profiles[key] = { deviceKey: deviceKeyOf(gamepad), bindings, savedAt: new Date().toISOString() };
  saveAllProfiles(profiles);
  return profiles[key];
}

// The explicitly-chosen "this one is the drum" device (controller-setup.js),
// so gameplay can ignore any other gamepad-shaped device that happens to be
// connected at the same time (a wireless headset with media buttons can
// enumerate as a gamepad; see game/round.js's use of this). null means
// "nothing chosen yet", not "any device is fine forever" — the UI should
// still prompt for a choice when more than one device is present.
export function getSelectedDeviceKey() {
  return store.get('input:selectedDevice', null);
}

export function setSelectedDeviceKey(deviceKey) {
  store.set('input:selectedDevice', deviceKey);
}

export function resolveZone(gamepad, raw) {
  const profile = getProfile(gamepad);
  if (!profile) return null;
  if (raw.kind === 'button') return profile.bindings.button?.[raw.index] ?? null;
  if (raw.kind === 'axis') {
    const b = profile.bindings.axis?.[raw.index];
    if (!b) return null;
    return Math.sign(raw.delta) === b.dir ? b.zone : null;
  }
  return null;
}

// ---- capture / remap protocol ----
// Clone drums sometimes fire BOTH a button and an axis for one physical hit
// (documented in an OpenTaiko bug report against a clone). Requiring the
// same candidate twice in a row is what resolves that ambiguity: a genuine
// double-fire won't reproduce the exact same (kind,index[,dir]) twice.
export class ZoneCapture {
  constructor() {
    this.pending = null;
  }

  // raw: {kind:'button', index} | {kind:'axis', index, delta}
  offer(raw) {
    const candidate =
      raw.kind === 'button' ? { kind: 'button', index: raw.index } : { kind: 'axis', index: raw.index, dir: Math.sign(raw.delta) };
    if (!this.pending) {
      this.pending = candidate;
      return { done: false };
    }
    const matches =
      this.pending.kind === candidate.kind && this.pending.index === candidate.index && this.pending.dir === candidate.dir;
    if (matches) {
      this.pending = null;
      return { done: true, binding: candidate };
    }
    this.pending = candidate; // mismatch: restart on the new candidate
    return { done: false, mismatch: true };
  }

  reset() {
    this.pending = null;
  }
}

// ---- keyboard fallback binding (default: Space/Enter -> a single generic zone) ----

const DEFAULT_KEYBOARD_BINDINGS = { Space: 'generic-hit', Enter: 'generic-hit' };

export function getKeyboardBindings() {
  return store.get('input:keyboard', { ...DEFAULT_KEYBOARD_BINDINGS });
}

export function saveKeyboardBindings(bindings) {
  store.set('input:keyboard', bindings);
}

export function resetKeyboardBindings() {
  store.set('input:keyboard', { ...DEFAULT_KEYBOARD_BINDINGS });
}
