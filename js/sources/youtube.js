// YouTube IFrame Player wrapped as a Source. Its reputation for timing is
// worse than the reality: getCurrentTime() is not quantized to the ~250ms
// timeupdate rate. The parent-side API dead-reckons from a timestamp
// captured INSIDE the iframe at the sampling instant, so the sample is
// coherently timestamped and postMessage transport latency never enters the
// error budget. We read that raw `infoDelivery` message directly rather than
// calling the (synchronous, but still just a cache read) getCurrentTime(),
// so we have the exact anchor rather than YouTube's own re-derivation of it.
//
// Do NOT use a Promise-based getCurrentTime() wrapper anywhere in this file
// or its callers: those add a real postMessage round trip for a value that
// is already free.
import { BaseSource } from './source.js';

const STATE_NAMES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
const WATCHDOG_INTERVAL_MS = 250;
const WATCHDOG_STALE_MS = 600; // matches the parent API's own 1s extrapolation clamp, with margin
const CLOCK_RESET_RESIDUAL_MS = 50; // bigger jump than this = seek/ABR/stall, not jitter
const FALLBACK_POLL_DELAY_MS = 1500;
const FALLBACK_POLL_INTERVAL_MS = 200;

const ERROR_MESSAGES = {
  2: 'Invalid video ID.',
  5: 'HTML5 player error.',
  100: 'Video not found. It may be private or deleted.',
  101: 'The video owner disallows embedding.',
  150: 'The video owner disallows embedding.',
  153: 'Embedding blocked, likely a Referrer-Policy stripping the Referer header. ' +
    'This page sets referrerpolicy="strict-origin-when-cross-origin" on the iframe; ' +
    'a privacy extension may still be overriding it.',
};

let apiReadyPromise = null;
function ensureYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return apiReadyPromise;
}

export class YouTubeSource extends BaseSource {
  constructor(containerEl) {
    super();
    this.containerEl = containerEl;
    this.player = null;
    this.anchor = null; // { media: seconds, wallMs: Date.now()-domain ms, rate }
    this._expected = null; // { videoId, durationSec }
    this._iframeWindow = null;
    this._gotMessageSample = false;
    this._lastSampleAt = null;
    this._watchdogTimer = null;
    this._fallbackTimer = null;
    this._fallbackArmTimer = null;
    this._pendingUnmute = false;
    this._wasEverUnmuted = false;
    this._userVolume = 100;
    this._onMessageBound = this._onMessage.bind(this);
    window.addEventListener('message', this._onMessageBound);
  }

  async load({ youtubeId, durationSec = null, origin = location.origin }) {
    const YT = await ensureYouTubeAPI();
    this._expected = { videoId: youtubeId, durationSec };
    this.anchor = null;
    return new Promise((resolve, reject) => {
      let settled = false;
      this.player = new YT.Player(this.containerEl, {
        videoId: youtubeId,
        playerVars: {
          enablejsapi: 1,
          origin,
          playsinline: 1,
          disablekb: 1,
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          fs: 1,
        },
        events: {
          onReady: () => {
            try {
              const iframe = this.player.getIframe();
              this._iframeWindow = iframe?.contentWindow ?? null;
              iframe?.setAttribute('allow', 'autoplay; encrypted-media');
              iframe?.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            } catch (err) {
              console.warn('[youtube] could not adjust iframe attributes', err);
            }
            this.player.setVolume(this._userVolume);
            this._startWatchdog();
            this.events.emit('ready', {});
            if (!settled) {
              settled = true;
              resolve();
            }
          },
          onStateChange: (e) => this._onStateChange(e),
          onError: (e) => {
            this._onError(e);
            if (!settled) {
              settled = true;
              reject(new Error(ERROR_MESSAGES[e?.data] || `YouTube error ${e?.data}`));
            }
          },
        },
      });
    });
  }

  _onMessage(e) {
    if (!this._iframeWindow || e.source !== this._iframeWindow) return;
    let data;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!data || data.event !== 'infoDelivery' || !data.info) return;
    const info = data.info;
    if (info.currentTime == null || info.currentTimeLastUpdated_ == null) return;
    this._gotMessageSample = true;
    this._applySample({
      media: info.currentTime,
      wallMs: info.currentTimeLastUpdated_ * 1000,
      rate: info.playbackRate ?? 1,
    });
  }

  _startFallbackPoll() {
    if (this._fallbackTimer) return;
    this._fallbackTimer = setInterval(() => {
      const info = this.player?.playerInfo;
      if (!info || info.currentTime == null || info.currentTimeLastUpdated_ == null) return;
      this._applySample({
        media: info.currentTime,
        wallMs: info.currentTimeLastUpdated_ * 1000,
        rate: info.playbackRate ?? 1,
      });
    }, FALLBACK_POLL_INTERVAL_MS);
  }

  _applySample(sample) {
    if (this.anchor) {
      const predicted = this._predict(this.anchor, sample.wallMs);
      if (Math.abs(predicted - sample.media) * 1000 > CLOCK_RESET_RESIDUAL_MS) {
        this.events.emit('clockreset', {});
      }
    }
    this.anchor = sample;
    this._lastSampleAt = performance.now();
  }

  _predict(anchor, wallMs) {
    return anchor.media + ((wallMs - anchor.wallMs) / 1000) * anchor.rate;
  }

  _startWatchdog() {
    this._lastSampleAt = performance.now();
    this._fallbackArmTimer = setTimeout(() => {
      if (!this._gotMessageSample) this._startFallbackPoll();
    }, FALLBACK_POLL_DELAY_MS);
    this._watchdogTimer = setInterval(() => {
      if (this.getState() === 'playing' && this._lastSampleAt && performance.now() - this._lastSampleAt > WATCHDOG_STALE_MS) {
        this.events.emit('clockinvalid', { reason: 'stale-clock' });
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  _onStateChange(e) {
    const state = STATE_NAMES[String(e.data)] ?? 'unknown';
    if (this._pendingUnmute && state === 'playing') {
      this.player.unMute();
      this._pendingUnmute = false;
      this._wasEverUnmuted = true;
    }
    this._setState(state);
  }

  _onError(e) {
    const code = e?.data;
    this.events.emit('error', { code, message: ERROR_MESSAGES[code] ?? `YouTube player error ${code}` });
  }

  // Chrome's autoplay policy can silently swallow a programmatic playVideo()
  // call that happens several `await` boundaries after the triggering click
  // (as ours does: load()/onReady round trips sit in between), leaving the
  // player stuck at playerState -1 forever with no error. Muted autoplay is
  // unconditionally allowed in every browser regardless of gesture history,
  // and unmuting a video that's already playing does not re-trigger the
  // restriction, so mute-then-unmute-on-playing is the standard, reliable
  // workaround rather than something to special-case per browser.
  play() {
    if (!this.player) return;
    if (!this._wasEverUnmuted && !this.player.isMuted()) {
      this.player.mute();
      this._pendingUnmute = true;
    }
    this.player.playVideo();
  }

  pause() {
    this.player?.pauseVideo();
  }

  seek(seconds) {
    this.anchor = null; // force a hard re-anchor rather than smoothing through a seek
    this.player?.seekTo(seconds, true);
  }

  // The one function every timing number in the game reduces to.
  mediaTimeAt(perfMs) {
    if (!this.anchor) return null;
    const wallAtHit = performance.timeOrigin + perfMs;
    return this._predict(this.anchor, wallAtHit);
  }

  getDuration() {
    try {
      return this.player?.getDuration?.() || null;
    } catch {
      return null;
    }
  }

  // Volume and mute are independent flags in the IFrame API: unmuting later
  // (the autoplay-unlock in play(), above) reveals whatever this was last
  // set to, no special-casing needed between the two.
  setVolume(vol) {
    this._userVolume = Math.max(0, Math.min(100, vol));
    this.player?.setVolume(this._userVolume);
  }

  getVolume() {
    return this._userVolume;
  }

  // YT.Player replaces the element it's given with the actual <iframe>, so
  // the container we constructed with is gone; this is the live node.
  getMediaElement() {
    try {
      return this.player?.getIframe?.() ?? null;
    } catch {
      return null;
    }
  }

  // There is no public getAdState(); this is the closest reliable proxy.
  // getDuration() === 0 means "metadata not loaded yet", not necessarily an
  // ad. Only treat a MISMATCHED duration/video id as a sign of an ad.
  isExpectedContentPlaying() {
    if (!this.player || !this._expected) return false;
    try {
      const data = this.player.getVideoData?.();
      const duration = this.player.getDuration?.();
      if (!data || data.video_id !== this._expected.videoId) return false;
      if (!duration) return false;
      if (this._expected.durationSec && Math.abs(duration - this._expected.durationSec) > 1) return false;
      return this.getState() === 'playing';
    } catch {
      return false;
    }
  }

  // Waits for consecutive low-residual samples after a seek before letting
  // the caller trust the clock for scoring. Mirrors MediaSync's "~3 seconds
  // to reach echoless" finding, but data-driven instead of a fixed delay.
  //
  // The deadline is a real setTimeout, deliberately independent of the
  // requestAnimationFrame polling loop below: rAF is throttled or fully
  // paused when a tab is backgrounded/unfocused (also observed under
  // browser automation), and if the *timeout itself* only gets checked
  // inside an rAF callback, a paused rAF means neither resolve() nor
  // reject() ever fires, so this hangs forever instead of degrading
  // gracefully. setTimeout still fires (at worst throttled, never paused).
  waitForStableClock({ minSamples = 3, maxResidualMs = 5, timeoutMs = 4000 } = {}) {
    let consecutive = 0;
    let lastAnchor = null;
    let settled = false;
    let rafId = null;

    return new Promise((resolve, reject) => {
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (rafId != null) cancelAnimationFrame(rafId);
        fn(arg);
      };
      const timeoutId = setTimeout(() => finish(reject, new Error('clock-stabilize-timeout')), timeoutMs);

      const check = () => {
        if (settled) return;
        if (this.getState() !== 'playing') {
          rafId = requestAnimationFrame(check);
          return;
        }
        if (this.anchor && this.anchor !== lastAnchor) {
          if (lastAnchor) {
            const predicted = this._predict(lastAnchor, this.anchor.wallMs);
            const residualMs = Math.abs(predicted - this.anchor.media) * 1000;
            consecutive = residualMs <= maxResidualMs ? consecutive + 1 : 0;
          }
          lastAnchor = this.anchor;
        }
        if (consecutive >= minSamples) {
          finish(resolve);
          return;
        }
        rafId = requestAnimationFrame(check);
      };
      check();
    });
  }

  destroy() {
    clearInterval(this._watchdogTimer);
    clearInterval(this._fallbackTimer);
    clearTimeout(this._fallbackArmTimer);
    window.removeEventListener('message', this._onMessageBound);
    try {
      this.player?.destroy();
    } catch {
      /* ignore */
    }
  }
}
