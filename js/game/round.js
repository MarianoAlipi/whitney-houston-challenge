// The round state machine. This is where the timing model from the plan
// actually gets applied: error_ms = ( M(t_obs) - T - A ) * 1000.
import { bus } from '../core/events.js';
import { judge, computeConfidence, ACCEPT_WINDOW_SEC, SONG_BPM, MISS_TIER } from './judge.js';
import { getActiveCalibrationOffsetMs, hasAnyCalibration } from '../audio/calibration.js';
import { isFirefoxOnMac } from '../input/gamepad.js';
import { getSelectedDeviceKey } from '../input/bindings.js';
import { runLeadInMetronome } from '../audio/metronome.js';

export const RoundState = {
  IDLE: 'idle',
  ARMING: 'arming', // seeking + waiting for a stable clock
  LISTENING: 'listening', // accepting hits, scoring against dropAt
  JUDGED: 'judged',
};

const LEAD_IN_SEC = 12;

export class Round {
  constructor(
    source,
    { dropAt, targetMarked = false, runUpFrom = null, showApproach = false, metronome = false, metronomeHalfTime = false, metronomeOffsetSec = 0 } = {}
  ) {
    this.source = source;
    this.dropAt = dropAt;
    this.targetMarked = targetMarked;
    this.runUpFrom = runUpFrom ?? Math.max(0, dropAt - LEAD_IN_SEC);
    this.showApproach = showApproach;
    this.metronome = metronome;
    this.metronomeHalfTime = metronomeHalfTime;
    this.metronomeOffsetSec = metronomeOffsetSec;
    this.state = RoundState.IDLE;

    this._offHit = null;
    this._progressRaf = null;
    this._metronomeHandle = null;
    this._clockUnstable = false;
    this._offClockInvalid = source.events.on('clockinvalid', () => {
      this._clockUnstable = true;
    });
    this._offClockReset = source.events.on('clockreset', () => {
      this._clockUnstable = true;
    });
  }

  _setState(state) {
    this.state = state;
    bus.emit('round:state', { state });
  }

  async arm() {
    this._setState(RoundState.ARMING);
    this._clockUnstable = false;
    this.source.seek(this.runUpFrom);
    this.source.play();
    if (typeof this.source.waitForStableClock === 'function') {
      try {
        await this.source.waitForStableClock();
      } catch {
        this._clockUnstable = true;
      }
    }
    if (this.state !== RoundState.ARMING) return;
    if (this.metronome) {
      this._metronomeHandle = runLeadInMetronome({
        source: this.source,
        dropAt: this.dropAt,
        runUpFrom: this.runUpFrom,
        bpm: this.metronomeHalfTime ? SONG_BPM / 2 : SONG_BPM,
        offsetSec: this.metronomeOffsetSec,
      });
    }
    this._startListening();
  }

  _stopMetronome() {
    this._metronomeHandle?.stop();
    this._metronomeHandle = null;
  }

  _startListening() {
    this._setState(RoundState.LISTENING);
    this._offHit = bus.on('input:hit', (evt) => this._onHit(evt));
    if (this.showApproach) this._startProgressLoop();
    // Without this, a round that never gets a valid hit (a genuine miss, or
    // the video simply reaching its end) waits forever with no way for the
    // UI to move on: there is otherwise no "the window has closed" signal.
    const timeoutMs = Math.max(500, (this.dropAt - this.runUpFrom + ACCEPT_WINDOW_SEC + 1) * 1000);
    this._missTimer = setTimeout(() => this._finishNoHit(), timeoutMs);
  }

  _finishNoHit() {
    if (this.state !== RoundState.LISTENING) return;
    const confidence = computeConfidence({
      targetMarked: this.targetMarked,
      calibrationPassed: hasAnyCalibration(),
      browserWarning: isFirefoxOnMac(),
      clockStable: !this._clockUnstable,
    });
    this._finish({
      grade: MISS_TIER.grade,
      color: MISS_TIER.color,
      subtitle: MISS_TIER.subtitle,
      errorMs: null,
      absMs: null,
      early: null,
      confidence,
      noHit: true,
      zone: null,
      device: null,
      deviceId: null,
    });
  }

  _startProgressLoop() {
    const total = this.dropAt - this.runUpFrom;
    const step = () => {
      if (this.state !== RoundState.LISTENING) return;
      const now = this.source.mediaTimeAt(performance.now());
      // Real-world observation: right after seek()+play(), the source's
      // clock can legitimately take a few seconds to anchor (see the plan's
      // YouTube-timing notes), so emit `ready:false` rather than nothing at
      // all, so the UI can say "syncing…" instead of silently freezing.
      if (now != null && total > 0) {
        const fraction = Math.max(0, Math.min(1, 1 - (this.dropAt - now) / total));
        bus.emit('round:progress', { ready: true, fraction, secondsToDrop: this.dropAt - now });
      } else {
        bus.emit('round:progress', { ready: false, fraction: 0, secondsToDrop: null });
      }
      this._progressRaf = requestAnimationFrame(step);
    };
    this._progressRaf = requestAnimationFrame(step);
  }

  _onHit(evt) {
    if (this.state !== RoundState.LISTENING) return;
    // Ignore any other gamepad-shaped device connected at the same time as
    // the chosen one (see input/bindings.js) — keyboard always stays valid
    // as a fallback input, it's never filtered here.
    const selected = getSelectedDeviceKey();
    if (evt.device === 'gamepad' && selected && evt.deviceId !== selected) return;
    const mediaTime = this.source.mediaTimeAt(evt.timestamp);
    if (mediaTime == null || Math.abs(mediaTime - this.dropAt) > ACCEPT_WINDOW_SEC) return;

    const offsetMs = getActiveCalibrationOffsetMs(evt.deviceId);
    const errorMs = (mediaTime - this.dropAt) * 1000 - offsetMs;
    const result = judge(errorMs);
    const confidence = computeConfidence({
      targetMarked: this.targetMarked,
      calibrationPassed: hasAnyCalibration(),
      browserWarning: isFirefoxOnMac(),
      clockStable: !this._clockUnstable,
    });

    this._finish({ ...result, confidence, zone: evt.zone, device: evt.device, deviceId: evt.deviceId });
  }

  _finish(result) {
    this._teardownListening();
    this._stopMetronome();
    this._setState(RoundState.JUDGED);
    bus.emit('round:result', result);
  }

  _teardownListening() {
    this._offHit?.();
    this._offHit = null;
    if (this._progressRaf) cancelAnimationFrame(this._progressRaf);
    this._progressRaf = null;
    clearTimeout(this._missTimer);
    this._missTimer = null;
  }

  cancel() {
    this._teardownListening();
    this._stopMetronome();
    this._setState(RoundState.IDLE);
  }

  destroy() {
    this.cancel();
    this._offClockInvalid?.();
    this._offClockReset?.();
  }
}
