// Lookahead scheduler ("A Tale of Two Clocks" pattern,
// https://web.dev/articles/audio-scheduling). Click times are scheduled on
// the audio hardware clock, so they're immune to this timer's own jitter;
// the timer only needs to be roughly on time. Never use setTimeout alone for
// the actual click playback, only for deciding when to schedule ahead.
import { getAudioContext, perfToAudio } from '../core/clock.js';
import { scheduleClick } from './engine.js';

const LOOKAHEAD_SEC = 0.1;
const TICK_MS = 25;
const METRONOME_GAIN = 0.35;

export function runMetronome({ bpm = 120, beats = 20, onClick, onDone } = {}) {
  const ctx = getAudioContext();
  const period = 60 / bpm;
  const startAt = ctx.currentTime + 0.2;
  const clickTimes = [];
  for (let i = 0; i < beats; i++) clickTimes.push(startAt + i * period);

  let nextIndex = 0;
  let timer = null;
  let stopped = false;

  function pump() {
    if (stopped) return;
    while (nextIndex < clickTimes.length && clickTimes[nextIndex] < ctx.currentTime + LOOKAHEAD_SEC) {
      const when = clickTimes[nextIndex];
      scheduleClick(when);
      onClick?.(nextIndex, when);
      nextIndex++;
    }
    if (nextIndex >= clickTimes.length) {
      clearInterval(timer);
      const lastEnds = clickTimes[clickTimes.length - 1] + period;
      const waitMs = Math.max(0, (lastEnds - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (!stopped) onDone?.(clickTimes);
      }, waitMs);
    }
  }

  timer = setInterval(pump, TICK_MS);
  pump();

  return {
    clickTimes,
    period,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// The optional "count me in" lead-in metronome for a practice/challenge
// round (see game/round.js). Unlike runMetronome() above, every click time
// is already known up front (they count backward from dropAt so the last
// click lands right on the drop), so this schedules them all in one pass on
// the hardware audio clock rather than running its own lookahead ticker.
//
// Media-time click instants are converted to AudioContext time by sampling
// the source's clock once (mediaTimeAt) and extrapolating at 1x from there,
// rather than reading the source's internal anchor directly: a few ms of
// drift in that extrapolation is inaudible for a metronome click, unlike the
// actual scoring math, which is why this doesn't need the source's real
// clock-correlation machinery.
// `offsetSec` (data/targets.json's metronomeOffsetSec) shifts the whole grid
// earlier/later: the drop isn't guaranteed to sit exactly on a downbeat, so
// the anchor beat is `dropAt + offsetSec` rather than `dropAt` itself. Tuned
// by ear per preset, same as dropAt was.
export function runLeadInMetronome({ source, dropAt, runUpFrom, bpm, offsetSec = 0 }) {
  const ctx = getAudioContext();
  const period = 60 / bpm;
  const anchor = dropAt + offsetSec;
  const mediaClickTimes = [];
  for (let t = anchor; t >= runUpFrom; t -= period) mediaClickTimes.push(t);
  mediaClickTimes.reverse();

  const nowPerfMs = performance.now();
  const nowMedia = source.mediaTimeAt(nowPerfMs);
  const nodes = [];
  if (nowMedia != null) {
    for (const mediaTime of mediaClickTimes) {
      const perfMsAtClick = nowPerfMs + (mediaTime - nowMedia) * 1000;
      const audioTime = perfToAudio(perfMsAtClick);
      if (audioTime < ctx.currentTime - 0.05) continue; // already passed, don't burst-fire it late
      nodes.push(scheduleClick(audioTime, { gain: METRONOME_GAIN }));
    }
  }

  return {
    stop() {
      for (const node of nodes) {
        try {
          node.stop();
        } catch {
          /* already finished */
        }
      }
    },
  };
}
