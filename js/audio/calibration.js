// The calibration wizard. Measures A = S + I (audio output latency + input
// latency) with one silent tap test, see the plan's proof that D (display
// latency) never enters the scoring math, so one number is all this game
// needs. Algorithm synthesized from osu!lazer (median, quality gate),
// Quaver (gate before suggesting), Clone Hero (what NOT to do: plain mean),
// and Rhythm Quest (a tap must make no sound, or the feedback SFX's own
// latency contaminates the measurement).
import { bus } from '../core/events.js';
import { perfToAudio } from '../core/clock.js';
import { runMetronome } from './metronome.js';
import * as store from '../core/store.js';

const BPM = 120;
const TOTAL_BEATS = 20;
const DISCARD_FIRST = 4; // rhythm entrainment settling
const WRONG_BEAT_FRACTION = 0.4;
const MAD_TO_SD = 1.4826;
const OUTLIER_K = 3 * MAD_TO_SD;
const MIN_KEPT = 10;
const MAX_ROBUST_SD_MS = 35;

export function runCalibrationWizard({ onBeat, onTap, onDone } = {}) {
  const period = 60 / BPM;
  const taps = [];

  // The tap itself makes no sound, see module comment.
  const offHit = bus.on('input:hit', (evt) => {
    taps.push({ ...evt, audioTime: perfToAudio(evt.timestamp) });
    onTap?.(evt);
  });

  const metro = runMetronome({
    bpm: BPM,
    beats: TOTAL_BEATS,
    onClick: (i, when) => onBeat?.(i, when),
    onDone: (clickTimes) => {
      offHit();
      onDone?.(computeResult(clickTimes, taps, period));
    },
  });

  return {
    stop() {
      offHit();
      metro.stop();
    },
  };
}

function computeResult(clickTimes, taps, period) {
  const usableClicks = clickTimes.slice(DISCARD_FIRST);
  const points = [];
  const errors = [];

  for (const tap of taps) {
    let nearest = null;
    let nearestDelta = Infinity;
    for (const c of usableClicks) {
      const delta = tap.audioTime - c;
      if (Math.abs(delta) < Math.abs(nearestDelta)) {
        nearestDelta = delta;
        nearest = c;
      }
    }
    if (nearest === null) continue;
    const errMs = nearestDelta * 1000;
    const rejected = Math.abs(nearestDelta) > WRONG_BEAT_FRACTION * period;
    points.push({ errMs, rejected });
    if (!rejected) errors.push(errMs);
  }

  if (errors.length === 0) {
    return { ok: false, reason: 'no-taps', points, nTotal: points.length };
  }

  const roughMedian = medianOf(errors);
  const roughMad = medianOf(errors.map((e) => Math.abs(e - roughMedian)));
  const kept = errors.filter((e) => roughMad === 0 || Math.abs(e - roughMedian) <= OUTLIER_K * roughMad);

  const offsetMs = medianOf(kept);
  const finalMad = medianOf(kept.map((e) => Math.abs(e - offsetMs)));
  const robustSdMs = finalMad * MAD_TO_SD;

  const reason = kept.length < MIN_KEPT ? 'too-few-taps' : robustSdMs > MAX_ROBUST_SD_MS ? 'inconsistent' : null;

  return {
    ok: reason === null,
    reason,
    offsetMs,
    robustSdMs,
    nKept: kept.length,
    nTotal: points.length,
    points,
    deviceKeyUsed: majorityDeviceKey(taps),
  };
}

// Which physical device actually produced most of the taps, used as the
// default deviceKey when saving the profile, so "calibrate" and "score"
// agree on device identity without the user having to say it twice.
function majorityDeviceKey(taps) {
  const counts = new Map();
  for (const t of taps) counts.set(t.deviceId, (counts.get(t.deviceId) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function medianOf(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- persistence: one offset per named profile ("Living room TV", device) ----

export function saveCalibrationProfile(name, deviceKey, offsetMs) {
  const profiles = store.get('calibration:profiles', {});
  profiles[name] = { deviceKey, offsetMs, savedAt: new Date().toISOString() };
  store.set('calibration:profiles', profiles);
  store.set('calibration:active', name);
  return profiles[name];
}

export function listCalibrationProfiles() {
  return store.get('calibration:profiles', {});
}

export function getActiveProfileName() {
  return store.get('calibration:active', null);
}

export function setActiveCalibrationProfile(name) {
  store.set('calibration:active', name);
}

export function deleteCalibrationProfile(name) {
  const profiles = store.get('calibration:profiles', {});
  delete profiles[name];
  store.set('calibration:profiles', profiles);
  if (store.get('calibration:active') === name) store.remove('calibration:active');
}

// The one number round.js actually needs: offset (ms) for a given device.
// Falls back across devices, then to 0 (uncalibrated); round.js reflects
// that in the confidence badge rather than pretending precision it doesn't have.
export function getActiveCalibrationOffsetMs(deviceKey = null) {
  const active = getActiveProfileName();
  const profiles = listCalibrationProfiles();
  if (active && profiles[active] && (!deviceKey || profiles[active].deviceKey === deviceKey)) {
    return profiles[active].offsetMs;
  }
  if (deviceKey) {
    const match = Object.values(profiles).find((p) => p.deviceKey === deviceKey);
    if (match) return match.offsetMs;
  }
  return active && profiles[active] ? profiles[active].offsetMs : 0;
}

export function hasAnyCalibration() {
  return Object.keys(listCalibrationProfiles()).length > 0;
}
