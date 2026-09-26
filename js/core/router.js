// Minimal hash router. No SPA rewrite rules needed on GitHub Pages this way,
// since `#/play` never hits the server, so there's nothing for the 404.html
// hack to work around.
const screens = new Map(); // name -> { mount(container, params) -> unmount? }
let container = null;
let current = null; // { name, unmountPromise }
let renderGeneration = 0;

export function register(name, screen) {
  screens.set(name, screen);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, query] = raw.split('?');
  const params = {};
  if (query) {
    for (const pair of query.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { name: name || null, params };
}

export function navigate(name, params = {}) {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  location.hash = `#/${name}${query ? `?${query}` : ''}`;
}

// mount() may be sync (returns an unmount fn or undefined) or async (some
// screens await loadPresets() etc. before returning one). screen.mount()
// itself returns a Promise either way once wrapped, so this handles both
// uniformly rather than assuming a plain function comes back immediately.
// The generation guard means a second navigation that arrives while an
// async mount is still pending doesn't race it: we still await and run the
// stale screen's cleanup once it resolves, we just don't let it mount.
async function render() {
  const myGeneration = ++renderGeneration;
  const { name, params } = parseHash();
  const target = name && screens.has(name) ? name : 'home';

  if (current) {
    const previous = current;
    current = null;
    try {
      const unmountFn = await previous.unmountPromise;
      if (typeof unmountFn === 'function') unmountFn();
    } catch (err) {
      console.error('[router] unmount failed', err);
    }
  }

  if (myGeneration !== renderGeneration) return; // superseded by a later navigation

  const screen = screens.get(target);
  if (!container || !screen) return;
  container.innerHTML = '';
  const unmountPromise = Promise.resolve(screen.mount(container, params));
  current = { name: target, unmountPromise };
}

export function start(rootEl, defaultScreen = 'home') {
  container = rootEl;
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = `#/${defaultScreen}`;
  else render();
}
