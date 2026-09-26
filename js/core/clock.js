// Shared AudioContext + the performance.now() <-> AudioContext.currentTime
// correlation. This is the single most important file in the app: every
// latency number the game reports depends on perfToAudio() being identical
// in the calibration wizard and in gameplay. Never branch it per caller.
//
// AudioContext.currentTime advances in render-quantum steps (128 frames,
// ~2.67ms @ 48kHz), so never do sub-ms math on raw deltas of it. Instead we
// correlate the two clocks via getOutputTimestamp() and smooth with an EMA,
// because Chrome's readings are known to jitter run-to-run while Firefox
// returns a stable past snapshot (see https://github.com/WebAudio/web-audio-api/issues/2461,
// never resolved by the spec editors). A constant error in this correlation
// is harmless: it becomes a constant that calibration measures and cancels.

let ctx = null;
let d = null; // EMA of (contextTime - performanceTime/1000), seconds

export function getAudioContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor({ latencyHint: 'interactive' });
  }
  return ctx;
}

// Must be called from a user gesture handler (click/keydown/gamepad press).
export async function unlockAudio() {
  const c = getAudioContext();
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch (err) {
      console.warn('[clock] AudioContext.resume() failed', err);
    }
  }
  return c;
}

// Call once per animation frame (or poll tick) while the app is running to
// keep the clock correlation warm. Cheap no-op if audio hasn't unlocked yet.
export function tick() {
  if (!ctx || typeof ctx.getOutputTimestamp !== 'function') return;
  let ts;
  try {
    ts = ctx.getOutputTimestamp();
  } catch {
    return;
  }
  if (!ts || !Number.isFinite(ts.performanceTime) || ts.performanceTime <= 0) return;
  // Sanity guard: performanceTime should be close to "now" in the same domain.
  if (Math.abs(performance.now() - ts.performanceTime) > 2000) return;
  const dNew = ts.contextTime - ts.performanceTime / 1000;
  d = d === null ? dNew : d + 0.05 * (dNew - d);
}

// Convert a performance.now()-domain timestamp (e.g. a gamepad hit) into
// AudioContext.currentTime-domain seconds.
export function perfToAudio(perfMs) {
  if (d !== null) return d + perfMs / 1000;
  // Fallback before we have a correlation sample yet: best-effort using
  // outputLatency/baseLatency as a *prior*, not ground truth (drivers lie:
  // Windows GetStreamLatency often reports 0, macOS Firefox reports 0 on
  // built-in speakers). This only runs for the first frame or two.
  const c = ctx;
  if (!c) return perfMs / 1000;
  const behindSec = (performance.now() - perfMs) / 1000;
  const outputLatency = c.outputLatency ?? 0;
  const baseLatency = c.baseLatency ?? 0;
  return c.currentTime - behindSec - outputLatency - baseLatency;
}

// Best-effort seed for a calibration slider default. Not trustworthy as a
// scoring input, see module comment.
export function estimatedOutputLatencyMs() {
  if (!ctx) return null;
  const total = (ctx.outputLatency ?? 0) + (ctx.baseLatency ?? 0);
  return total > 0 ? total * 1000 : null;
}
