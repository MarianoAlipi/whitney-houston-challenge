// Tiny hyperscript helper so screens read declaratively without a framework
// or build step. `h('button', {class:'btn', onClick: fn}, 'Play')`.
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'ref' && typeof value === 'function') value(el);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && typeof el[key] !== 'function') {
      try {
        el[key] = value;
      } catch {
        el.setAttribute(key, value);
      }
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function fmtMs(ms) {
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '±';
  return `${sign}${Math.abs(Math.round(ms))} ms`;
}

// The result screen's primary readout: milliseconds read as too precise to
// a casual player, seconds don't.
export function fmtSeconds(ms) {
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '±';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(2)}s`;
}

// Secondary readout, for players counting the beat along with the song
// rather than watching a number (see game/judge.js's SONG_BPM). Whole beats
// only: a fractional beat count isn't something a person counting along can
// actually place, unlike a decimal second count.
export function fmtBeats(ms, bpm) {
  const periodMs = 60000 / bpm;
  const beats = Math.round(Math.abs(ms) / periodMs);
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '±';
  return `${sign}${beats} beat${beats === 1 ? '' : 's'}`;
}

export function fmtTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(2).padStart(5, '0');
  return `${m}:${rem}`;
}
