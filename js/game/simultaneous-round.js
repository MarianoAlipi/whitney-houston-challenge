// Simultaneous-mode counterpart to Round: several participants (each a
// device, optionally narrowed to one drum zone for zone-split) hit during
// the SAME playthrough. Emits a live per-participant event as each hit
// lands, then one combined event once everyone has hit or the grace period
// after the drop elapses.
//
// Deliberately emits 'round:multiresult' rather than reusing Round's
// 'round:result': the payload shapes differ, and only one of the two round
// types is ever mounted at a time, but reusing the name would be a latent
// footgun for whoever touches this next.
import { bus } from '../core/events.js';
import { judge, computeConfidence, ACCEPT_WINDOW_SEC, MISS_TIER } from './judge.js';
import { getActiveCalibrationOffsetMs, hasAnyCalibration } from '../audio/calibration.js';
import { isFirefoxOnMac } from '../input/gamepad.js';

const LEAD_IN_SEC = 12;
const POST_DROP_GRACE_SEC = 2.5;

export class SimultaneousRound {
  // participants: [{ playerId, name, deviceId, zone? }]
  constructor(source, { dropAt, targetMarked = false, participants, runUpFrom = null } = {}) {
    this.source = source;
    this.dropAt = dropAt;
    this.targetMarked = targetMarked;
    this.participants = participants;
    this.runUpFrom = runUpFrom ?? Math.max(0, dropAt - LEAD_IN_SEC);
    this.state = 'idle';
    this.resultsByPlayer = new Map();

    this._offHit = null;
    this._closeTimer = null;
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
    this._setState('arming');
    this._clockUnstable = false;
    this.resultsByPlayer.clear();
    this.source.seek(this.runUpFrom);
    this.source.play();
    if (typeof this.source.waitForStableClock === 'function') {
      try {
        await this.source.waitForStableClock();
      } catch {
        this._clockUnstable = true;
      }
    }
    if (this.state === 'arming') this._startListening();
  }

  _startListening() {
    this._setState('listening');
    this._offHit = bus.on('input:hit', (evt) => this._onHit(evt));
    const totalWaitMs = Math.max(500, (this.dropAt - this.runUpFrom + POST_DROP_GRACE_SEC) * 1000);
    this._closeTimer = setTimeout(() => this._closeWindow(), totalWaitMs);
  }

  _matchParticipant(evt) {
    return this.participants.find((p) => {
      if (p.deviceId !== evt.deviceId) return false;
      return p.zone ? p.zone === evt.zone : true;
    });
  }

  _onHit(evt) {
    if (this.state !== 'listening') return;
    const participant = this._matchParticipant(evt);
    if (!participant || this.resultsByPlayer.has(participant.playerId)) return; // one hit per participant

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
    const full = { ...result, confidence, zone: evt.zone, device: evt.device, deviceId: evt.deviceId, playerId: participant.playerId, name: participant.name };
    this.resultsByPlayer.set(participant.playerId, full);
    bus.emit('round:participant-result', full);

    if (this.resultsByPlayer.size >= this.participants.length) this._closeWindow();
  }

  _closeWindow() {
    if (this.state !== 'listening') return;
    clearTimeout(this._closeTimer);
    this._offHit?.();
    this._offHit = null;
    this._setState('judged');

    // Every participant gets a result, including those who never landed a
    // scoreable hit. Otherwise their attempt silently doesn't count at all,
    // which is inconsistent with solo/turn-based play (see Round._finishNoHit).
    const confidence = computeConfidence({
      targetMarked: this.targetMarked,
      calibrationPassed: hasAnyCalibration(),
      browserWarning: isFirefoxOnMac(),
      clockStable: !this._clockUnstable,
    });
    const results = this.participants.map(
      (p) =>
        this.resultsByPlayer.get(p.playerId) ?? {
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
          deviceId: p.deviceId,
          playerId: p.playerId,
          name: p.name,
        }
    );
    bus.emit('round:multiresult', { participants: this.participants, results });
  }

  cancel() {
    clearTimeout(this._closeTimer);
    this._offHit?.();
    this._offHit = null;
    this._setState('idle');
  }

  destroy() {
    this.cancel();
    this._offClockInvalid?.();
    this._offClockReset?.();
  }
}
