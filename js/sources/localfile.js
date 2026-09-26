// Local file sources: the precision path (files never leave the machine).
//
// Audio -> decoded into an AudioBuffer and played through the same
// AudioContext the calibration wizard uses, so mediaTimeAt() shares the exact
// perfToAudio() correlation. Sample-accurate, and the calibrated offset
// applies directly with no cross-context guessing.
//
// Video -> a plain <video> element. Less exact (no per-sample timestamp the
// way YouTube's infoDelivery gives us), but still an anchor+extrapolation
// model rather than raw polling.
import { BaseSource } from './source.js';
import { getAudioContext, perfToAudio } from '../core/clock.js';

export class LocalAudioSource extends BaseSource {
  constructor() {
    super();
    this.buffer = null;
    this.node = null;
    this.durationSec = 0;
    this._startedAtAudioTime = null; // ctx.currentTime when the current node started
    this._mediaOffsetAtStart = 0; // media seconds at that instant
    this._rate = 1;
    this._userVolume = 100;
    this._gainNode = null; // created lazily once an AudioContext exists (load())
  }

  async load(file) {
    this._setState('buffering');
    const ctx = getAudioContext();
    this._gainNode = ctx.createGain();
    this._gainNode.gain.value = this._userVolume / 100;
    this._gainNode.connect(ctx.destination);
    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
    this.durationSec = this.buffer.duration;
    this._setState('cued');
    this.events.emit('ready', {});
  }

  play() {
    const ctx = getAudioContext();
    this._stopNode();
    this.node = ctx.createBufferSource();
    this.node.buffer = this.buffer;
    this.node.playbackRate.value = this._rate;
    this.node.connect(this._gainNode);
    const offset = Math.max(0, Math.min(this._mediaOffsetAtStart, this.durationSec));
    this.node.start(ctx.currentTime, offset);
    this._startedAtAudioTime = ctx.currentTime;
    this.node.onended = () => {
      if (this.getState() === 'playing') this._setState('ended');
    };
    this._setState('playing');
  }

  pause() {
    if (this.getState() !== 'playing') return;
    this._mediaOffsetAtStart = this._currentMediaTimeNow();
    this._stopNode();
    this._setState('paused');
  }

  seek(seconds) {
    const wasPlaying = this.getState() === 'playing';
    this._mediaOffsetAtStart = Math.max(0, Math.min(seconds, this.durationSec));
    this._stopNode();
    this.events.emit('clockreset', {});
    if (wasPlaying) this.play();
  }

  _stopNode() {
    if (this.node) {
      try {
        this.node.onended = null;
        this.node.stop();
      } catch {
        /* already stopped */
      }
      this.node = null;
    }
  }

  _currentMediaTimeNow() {
    if (this.getState() !== 'playing' || this._startedAtAudioTime === null) return this._mediaOffsetAtStart;
    const ctx = getAudioContext();
    return this._mediaOffsetAtStart + (ctx.currentTime - this._startedAtAudioTime) * this._rate;
  }

  mediaTimeAt(perfMs) {
    if (this.getState() !== 'playing' || this._startedAtAudioTime === null) return this._mediaOffsetAtStart;
    const audioTime = perfToAudio(perfMs);
    return this._mediaOffsetAtStart + (audioTime - this._startedAtAudioTime) * this._rate;
  }

  getDuration() {
    return this.durationSec || null;
  }

  setVolume(vol) {
    this._userVolume = Math.max(0, Math.min(100, vol));
    if (this._gainNode) this._gainNode.gain.value = this._userVolume / 100;
  }

  getVolume() {
    return this._userVolume;
  }

  destroy() {
    this._stopNode();
  }
}

export class LocalVideoSource extends BaseSource {
  constructor(containerEl) {
    super();
    this.containerEl = containerEl;
    this.videoEl = document.createElement('video');
    this.videoEl.playsInline = true;
    this.videoEl.controls = false;
    this.containerEl.appendChild(this.videoEl);
    this._objectUrl = null;
    this._anchor = null; // { media, perfMs, rate }

    this.videoEl.addEventListener('timeupdate', () => this._sample());
    this.videoEl.addEventListener('playing', () => this._setState('playing'));
    this.videoEl.addEventListener('pause', () => this._setState('paused'));
    this.videoEl.addEventListener('ended', () => this._setState('ended'));
    this.videoEl.addEventListener('waiting', () => this._setState('buffering'));
    this.videoEl.addEventListener('error', () =>
      this.events.emit('error', { code: this.videoEl.error?.code, message: 'Local video playback error' })
    );
  }

  async load(file) {
    this._setState('buffering');
    this._objectUrl = URL.createObjectURL(file);
    this.videoEl.src = this._objectUrl;
    await new Promise((resolve, reject) => {
      this.videoEl.addEventListener('loadedmetadata', resolve, { once: true });
      this.videoEl.addEventListener('error', () => reject(new Error('video-load-error')), { once: true });
    });
    this._setState('cued');
    this.events.emit('ready', {});
  }

  play() {
    this.videoEl.play();
  }

  pause() {
    this.videoEl.pause();
  }

  seek(seconds) {
    this._anchor = null;
    this.videoEl.currentTime = seconds;
    this.events.emit('clockreset', {});
  }

  _sample() {
    this._anchor = { media: this.videoEl.currentTime, perfMs: performance.now(), rate: this.videoEl.playbackRate || 1 };
  }

  mediaTimeAt(perfMs) {
    if (!this._anchor) return this.videoEl.currentTime;
    if (this.getState() !== 'playing') return this._anchor.media;
    return this._anchor.media + ((perfMs - this._anchor.perfMs) / 1000) * this._anchor.rate;
  }

  getDuration() {
    return this.videoEl.duration || null;
  }

  setVolume(vol) {
    this.videoEl.volume = Math.max(0, Math.min(100, vol)) / 100;
  }

  getVolume() {
    return this.videoEl.volume * 100;
  }

  getMediaElement() {
    return this.videoEl;
  }

  destroy() {
    this.videoEl.pause();
    this.videoEl.removeAttribute('src');
    this.videoEl.load();
    if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
    this.containerEl.removeChild(this.videoEl);
  }
}

export function createLocalSource(file, containerEl) {
  return file.type.startsWith('audio/') ? new LocalAudioSource() : new LocalVideoSource(containerEl);
}
