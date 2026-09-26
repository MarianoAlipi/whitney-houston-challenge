// Song presets + the "mark the target" overrides that make them usable.
//
// Every shipped preset ships with dropAt: null on purpose. Different
// uploads/edits of the same song have different pause timings, and guessing
// one and presenting it as fact would be dishonest. The app always prompts
// to mark the drop the first time a preset is played; after that this
// module remembers it via core/store.js.
import * as store from '../core/store.js';

let cache = null;

export async function loadPresets() {
  if (cache) return cache;
  const url = new URL('../../data/targets.json', import.meta.url);
  const res = await fetch(url);
  const json = await res.json();
  cache = json.presets;
  return cache;
}

export function getMarkedOverride(presetId) {
  const overrides = store.get('targets:overrides', {});
  return overrides[presetId] ?? null;
}

export function setMarkedOverride(presetId, dropAtSeconds) {
  const overrides = store.get('targets:overrides', {});
  overrides[presetId] = { dropAt: dropAtSeconds, markedAt: new Date().toISOString() };
  store.set('targets:overrides', overrides);
}

export function clearMarkedOverride(presetId) {
  const overrides = store.get('targets:overrides', {});
  delete overrides[presetId];
  store.set('targets:overrides', overrides);
}

// A preset is "measured" once either the host has marked it (preferred,
// self-calibrating, see the plan) or it ships with a verified dropAt.
export function getEffectiveDropAt(preset) {
  const override = getMarkedOverride(preset.id);
  if (override) return { dropAt: override.dropAt, targetMarked: true };
  if (preset.dropAt != null) return { dropAt: preset.dropAt, targetMarked: false };
  return { dropAt: null, targetMarked: false };
}

export function isMeasured(preset) {
  return getEffectiveDropAt(preset).dropAt !== null;
}

// ---- ad-hoc "paste any YouTube link" support ----

export function parseYouTubeInput(input) {
  const trimmed = (input || '').trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    const v = url.searchParams.get('v');
    if (v) return v;
    const embedMatch = url.pathname.match(/\/embed\/([\w-]{11})/);
    if (embedMatch) return embedMatch[1];
  } catch {
    /* not a parseable URL */
  }
  return null;
}

export function makeAdHocPreset(youtubeId) {
  return {
    id: `custom-${youtubeId}`,
    title: 'Custom YouTube video',
    source: 'youtube',
    youtubeId,
    approxDurationSec: null,
    approxPauseStartSec: 0,
    dropAt: null,
    verified: false,
    custom: true,
  };
}

export function makeLocalFilePreset(file) {
  return {
    id: `local-${file.name}-${file.size}`,
    title: file.name,
    source: 'local',
    approxDurationSec: null,
    approxPauseStartSec: 0,
    dropAt: null,
    verified: false,
    custom: true,
  };
}
