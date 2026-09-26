// Procedural click generation, so we ship no audio assets at all.
import { getAudioContext } from '../core/clock.js';

const clickBuffers = new Map(); // freq -> AudioBuffer

function buildClickBuffer(ctx, freq) {
  const duration = 0.03;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 130); // fast decay so clicks stay percussive
    data[i] = Math.sin(2 * Math.PI * freq * t) * envelope;
  }
  return buffer;
}

// Schedule a click at an AudioContext.currentTime-domain instant. `when` is
// ground truth: the hardware fires it at the exact sample regardless of any
// jitter in the caller's own timer (see audio/metronome.js). `freq` lets a
// caller distinguish two sounds (e.g. don vs ka on the controller test
// screen) without shipping any audio assets; buffers are cached per
// frequency since building one is cheap but pointless to redo every call.
export function scheduleClick(when, { gain = 0.5, freq = 1800 } = {}) {
  const ctx = getAudioContext();
  let buffer = clickBuffers.get(freq);
  if (!buffer) {
    buffer = buildClickBuffer(ctx, freq);
    clickBuffers.set(freq, buffer);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ctx.destination);
  src.start(Math.max(when, ctx.currentTime));
  return src;
}
