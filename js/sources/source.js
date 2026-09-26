// Contract every playback source implements. Exactly one instance is active
// at a time, owned by game/round.js, so each gets its own EventBus rather
// than sharing the app-wide `bus` from core/events.js.
//
//   async load(descriptor)   load and cue the media; resolves once ready
//   play()                   start/resume playback
//   pause()                  pause playback
//   seek(seconds)            seek to a media position
//   mediaTimeAt(perfMs)      -> seconds | null; perfMs is a performance.now()
//                             domain timestamp (e.g. a gamepad hit). This is
//                             the function every timing number in the game
//                             ultimately calls.
//   getDuration()            -> seconds | null
//   getState()               -> 'unstarted'|'cued'|'playing'|'paused'|'buffering'|'ended'|'error'
//   setVolume(vol0to100)     set output volume; default no-op for a source that can't control it
//   getVolume()              -> 0-100
//   destroy()                release resources
//
//   events: EventBus emitting
//     'ready'        {}
//     'statechange'  { state }
//     'clockinvalid' { reason }   -- e.g. stale-clock watchdog trip
//     'clockreset'   {}           -- e.g. a seek or ABR switch; discard the window
//     'error'        { code, message }
import { EventBus } from '../core/events.js';

export class BaseSource {
  constructor() {
    this.events = new EventBus();
    this._state = 'unstarted';
  }

  getState() {
    return this._state;
  }

  _setState(state) {
    if (state === this._state) return;
    this._state = state;
    this.events.emit('statechange', { state });
  }

  async load() {
    throw new Error('load() not implemented');
  }

  play() {
    throw new Error('play() not implemented');
  }

  pause() {
    throw new Error('pause() not implemented');
  }

  seek() {
    throw new Error('seek() not implemented');
  }

  mediaTimeAt() {
    return null;
  }

  getDuration() {
    return null;
  }

  setVolume() {}

  getVolume() {
    return 100;
  }

  // The DOM node showing video (an <iframe> or <video>), or null for an
  // audio-only source. Callers must place this in a FIXED parent for the
  // life of the session and never detach/reparent it between rounds:
  // disconnecting an <iframe> from the document and reattaching it causes
  // browsers to reload it, silently resetting YouTube playback.
  getMediaElement() {
    return null;
  }

  destroy() {}
}
