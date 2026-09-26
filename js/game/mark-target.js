// "Tap the drop to mark it": the recommended way to set a target, because
// (per the plan) any error in the calibration offset cancels exactly when
// the same offset was in effect at marking time and at scoring time. Takes
// several takes; the caller (UI) shows a nudge control and commits via
// game/targets.js setMarkedOverride().
//
// Uses the EARLIEST take, not the median. This is a one-shot reaction to a
// surprise event, not a tap-to-a-predictable-beat task (that asymmetry is
// exactly why the calibration wizard in audio/calibration.js correctly uses
// a median instead): a human can only react at or after the true onset,
// never before, so every recorded time is >= the true drop and the minimum
// across several takes is the least-biased estimate. A median would just
// converge on "how late this person's reactions typically are", which is
// exactly the "target was set after the actual hit" bug this replaced.
import { bus } from '../core/events.js';

const DEFAULT_TAKES = 5;
// Guards the min-estimator against one wildly premature stray hit (hardware
// noise, an accidental double-fire right as playback starts), since min is
// not naturally outlier-robust the way a median is. This can only be anchored
// to `seekAt` (the one instant we actually know), NOT to a guessed drop time:
// we deliberately have no estimate of the real drop position yet, that is
// the entire point of this flow, and a preset's a-cappella pause can run
// anywhere from a few seconds to tens of seconds past the seek point.
const MIN_REACTION_SEC = 1;
// Real pauses can legitimately run 20-30+ seconds past the seek point (see
// data/targets.json's own note: being loose with the seek seed "just means a
// longer wait before the pause, not a scoring error"), plus a few seconds of
// YouTube buffering after each seek before playback audibly starts. Give a
// real take generous room rather than timing out before a genuine reaction
// could ever land.
const TAKE_TIMEOUT_MS = 45000;

export function runMarkTargetFlow(source, { seekAt = 0, takes = DEFAULT_TAKES, onTake, onDone } = {}) {
  const results = [];
  let cancelled = false;
  let offHit = null;

  async function doTake(index) {
    if (cancelled) return;
    source.seek(Math.max(0, seekAt));
    source.play();
    if (typeof source.waitForStableClock === 'function') {
      try {
        await source.waitForStableClock();
      } catch {
        /* proceed anyway: better an approximate take than a stuck wizard */
      }
    }
    if (cancelled) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = (mediaTime) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        offHit?.();
        offHit = null;
        // Deliberately NOT pausing here: the next take immediately seeks+plays
        // again anyway, and empirically, a rapid pause() right before the next
        // seek() made YouTube's infoDelivery stream stop arriving far more
        // often than seeking straight through without pausing in between.
        if (mediaTime != null) results.push(mediaTime);
        onTake?.({ index, mediaTime, total: takes });
        resolve();
      };
      const timeoutId = setTimeout(() => finish(null), TAKE_TIMEOUT_MS);
      offHit = bus.on('input:hit', (evt) => {
        const mediaTime = source.mediaTimeAt(evt.timestamp);
        if (mediaTime == null) return; // clock not ready yet, keep waiting, don't waste the take
        finish(mediaTime);
      });
    });
  }

  async function run() {
    for (let i = 0; i < takes; i++) {
      if (cancelled) return;
      await doTake(i);
    }
    source.pause();
    if (cancelled) return;
    onDone?.({ takes: results.slice(), best: earliestPlausible(results, seekAt) });
  }
  run();

  return {
    cancel() {
      cancelled = true;
      offHit?.();
      offHit = null;
      source.pause();
    },
  };
}

function earliestPlausible(arr, seekAt) {
  if (arr.length === 0) return null;
  const plausible = arr.filter((t) => t >= seekAt + MIN_REACTION_SEC);
  const pool = plausible.length ? plausible : arr; // don't strand the estimate if every take was "implausible"
  return Math.min(...pool);
}
