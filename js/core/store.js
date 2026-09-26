// localStorage wrapper, namespaced and versioned.
//
// Why this matters here specifically: every `<user>.github.io/<repo>/` project
// shares ONE origin (`https://<user>.github.io`), so unprefixed keys from this
// game and unprefixed keys from some other project hosted under the same
// username collide. Every key we touch goes through this module so the prefix
// and version are applied exactly once, everywhere.
const PREFIX = 'whitney:v1:';

function fullKey(key) {
  return PREFIX + key;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch (err) {
    // Safari private mode throws on setItem; a corrupted value throws on parse.
    console.warn('[store] storage access failed', err);
    return fallback;
  }
}

export function get(key, fallback = null) {
  return safe(() => {
    const raw = localStorage.getItem(fullKey(key));
    if (raw === null) return fallback;
    return JSON.parse(raw);
  }, fallback);
}

export function set(key, value) {
  return safe(() => {
    localStorage.setItem(fullKey(key), JSON.stringify(value));
    return true;
  }, false);
}

export function remove(key) {
  return safe(() => {
    localStorage.removeItem(fullKey(key));
    return true;
  }, false);
}

// All of *our* keys (never touches other projects sharing the origin).
export function allKeys() {
  return safe(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }, []);
}

// Safari (ITP) deletes all script-writable storage after 7 days with no
// interaction with the site. That's not fixable from here, so make losing
// it cheap: export/import the whole namespace as one JSON blob.
export function exportJSON() {
  const data = {};
  for (const key of allKeys()) data[key] = get(key);
  return JSON.stringify({ prefix: PREFIX, exportedAt: new Date().toISOString(), data }, null, 2);
}

export function importJSON(json) {
  return safe(() => {
    const parsed = JSON.parse(json);
    const data = parsed && parsed.data ? parsed.data : parsed;
    for (const [key, value] of Object.entries(data)) set(key, value);
    return true;
  }, false);
}
