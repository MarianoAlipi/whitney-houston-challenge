import { h, clear } from '../../core/dom.js';
import { bus } from '../../core/events.js';
import { listConnectedGamepads, setCaptureMode, isFirefoxOnMac } from '../../input/gamepad.js';
import {
  ZONES,
  ZoneCapture,
  getProfile,
  saveProfile,
  deviceKeyOf,
  getSelectedDeviceKey,
  setSelectedDeviceKey,
  getKeyboardBindings,
  saveKeyboardBindings,
  resetKeyboardBindings,
} from '../../input/bindings.js';
import * as webhid from '../../input/webhid.js';
import { scheduleClick } from '../../audio/engine.js';
import { getAudioContext } from '../../core/clock.js';

const ZONE_LABELS = {
  'ka-left': 'Ka · left rim',
  'ka-right': 'Ka · right rim',
  'don-left': 'Don · left centre',
  'don-right': 'Don · right centre',
};
// Distinct pitches so the audiovisual test feedback sounds like the real
// instrument's two tones rather than one identical click for every zone.
const ZONE_FREQ = { 'ka-left': 1800, 'ka-right': 1800, 'don-left': 260, 'don-right': 260 };
const TEST_FLASH_MS = 250;
const DEVICE_FLASH_MS = 350;

export default {
  mount(container) {
    const state = { gamepad: null, capturingZone: null, capture: null };
    let testFlashZone = null;
    let testFlashTimer = null;
    let flashDeviceKey = null; // most recently active device, for the picker below
    let flashDeviceTimer = null;

    const firefoxWarning = isFirefoxOnMac()
      ? h('div', { class: 'card', style: 'border-color:var(--don)' }, [
          h(
            'p',
            {},
            '⚠ Firefox on macOS polls gamepads at only 20Hz (~25ms average extra delay), with no fix available from this page. Chrome or Safari is strongly recommended for this game.'
          ),
        ])
      : null;

    const devicePicker = h('div', { class: 'stack' });
    const noDeviceNotice = h('p', { class: 'muted' }, 'No controller detected yet. Hit any drum pad to connect it.');
    const zoneGrid = h('div', { class: 'zone-grid' });
    const rawMonitor = h('div', { class: 'raw-monitor' }, 'waiting for input…');
    const webhidRow = h('div', { class: 'row row-wrap' });
    const kbInfo = h('p', { class: 'muted' }, describeKeyboardBindings());

    function describeKeyboardBindings() {
      return `Keyboard fallback: ${Object.keys(getKeyboardBindings()).join(', ')} → hit`;
    }

    // Which gamepad the rest of this screen (and rebinding) operates on:
    // the explicitly selected device if it's still connected, else whatever
    // was first to enumerate, so a fresh install still works out of the box.
    function resolveActiveGamepad(pads) {
      const selectedKey = getSelectedDeviceKey();
      return (selectedKey && pads.find((p) => deviceKeyOf(p) === selectedKey)) || pads[0] || null;
    }

    function selectDevice(gp) {
      setSelectedDeviceKey(deviceKeyOf(gp));
      refreshGamepad();
    }

    function renderDevicePicker(pads) {
      clear(devicePicker);
      if (!pads.length) {
        devicePicker.appendChild(noDeviceNotice);
        return;
      }
      if (pads.length > 1) {
        devicePicker.appendChild(
          h(
            'p',
            { class: 'muted' },
            "More than one device showed up as a controller (a headset with media buttons can do this too). Hit your drum, watch which row lights up below, then select it as the one to use."
          )
        );
      }
      const selectedKey = getSelectedDeviceKey();
      for (const gp of pads) {
        const key = deviceKeyOf(gp);
        devicePicker.appendChild(
          h('div', { class: `row card device-row${key === flashDeviceKey ? ' flash' : ''}` }, [
            h('div', { class: 'spacer' }, [
              h('div', {}, gp.id),
              h('div', { class: 'muted num' }, `${gp.buttons.length} buttons, ${gp.axes.length} axes`),
            ]),
            key === selectedKey
              ? h('span', { class: 'pill' }, 'Using this one')
              : h('button', { class: 'btn', onClick: () => selectDevice(gp) }, 'Use this one'),
          ])
        );
      }
    }

    function markDeviceActivity(gp) {
      flashDeviceKey = deviceKeyOf(gp);
      renderDevicePicker(listConnectedGamepads());
      clearTimeout(flashDeviceTimer);
      flashDeviceTimer = setTimeout(() => {
        flashDeviceKey = null;
        renderDevicePicker(listConnectedGamepads());
      }, DEVICE_FLASH_MS);
    }

    function refreshGamepad() {
      const pads = listConnectedGamepads();
      state.gamepad = resolveActiveGamepad(pads);
      renderDevicePicker(pads);
      renderZones();
    }

    function currentBindingLabel(zone) {
      if (!state.gamepad) return '-';
      const profile = getProfile(state.gamepad);
      if (!profile) return 'unbound';
      const buttonEntry = Object.entries(profile.bindings.button || {}).find(([, z]) => z === zone);
      if (buttonEntry) return `button ${buttonEntry[0]}`;
      const axisEntry = Object.entries(profile.bindings.axis || {}).find(([, b]) => b.zone === zone);
      if (axisEntry) return `axis ${axisEntry[0]} (${profile.bindings.axis[axisEntry[0]].dir > 0 ? '+' : '−'})`;
      return 'unbound';
    }

    function renderZones() {
      clear(zoneGrid);
      for (const zone of ZONES) {
        const flashing = state.capturingZone === zone || testFlashZone === zone;
        zoneGrid.appendChild(
          h('div', { class: `zone-pad zone-${zone}${flashing ? ' flash' : ''}` }, [
            h('div', {}, ZONE_LABELS[zone]),
            h('div', { class: 'muted num', style: 'margin:0.5rem 0' }, currentBindingLabel(zone)),
            h(
              'button',
              { class: 'btn', disabled: !state.gamepad, onClick: () => startCapture(zone) },
              state.capturingZone === zone ? 'Hit the pad twice…' : 'Rebind'
            ),
          ])
        );
      }
    }

    function startCapture(zone) {
      if (!state.gamepad) return;
      state.capturingZone = zone;
      state.capture = new ZoneCapture();
      setCaptureMode(true);
      renderZones();
    }

    function commitCapture(zone, binding) {
      const profile = getProfile(state.gamepad) ?? { bindings: { button: {}, axis: {} } };
      const bindings = { button: { ...profile.bindings.button }, axis: { ...profile.bindings.axis } };
      for (const k of Object.keys(bindings.button)) if (bindings.button[k] === zone) delete bindings.button[k];
      for (const k of Object.keys(bindings.axis)) if (bindings.axis[k].zone === zone) delete bindings.axis[k];
      if (binding.kind === 'button') {
        delete bindings.axis[binding.index];
        bindings.button[binding.index] = zone;
      } else {
        delete bindings.button[binding.index];
        bindings.axis[binding.index] = { zone, dir: binding.dir };
      }
      saveProfile(state.gamepad, bindings);
      state.capturingZone = null;
      state.capture = null;
      setCaptureMode(false);
      renderZones();
    }

    function flashZoneTest(zone) {
      scheduleClick(getAudioContext().currentTime, { freq: ZONE_FREQ[zone] ?? 1800, gain: 0.4 });
      testFlashZone = zone;
      renderZones();
      clearTimeout(testFlashTimer);
      testFlashTimer = setTimeout(() => {
        testFlashZone = null;
        renderZones();
      }, TEST_FLASH_MS);
    }

    function onRaw(raw) {
      const extra = raw.delta !== undefined ? ` Δ${raw.delta.toFixed(2)}` : '';
      rawMonitor.textContent = `${raw.device} ${raw.kind}#${raw.index}${extra} @ ${raw.timestamp.toFixed(1)}ms`;
      if (raw.device === 'gamepad') markDeviceActivity(raw.gamepad);
      if (!state.capturingZone || raw.device !== 'gamepad') return;
      const result = state.capture.offer(raw);
      if (result.done) commitCapture(state.capturingZone, result.binding);
    }

    // The live "test it" feedback: any resolved hit against a real drum
    // zone flashes + clicks, whether or not the player is mid-rebind, so a
    // default mapping can be confirmed without ever starting a round.
    const offHit = bus.on('input:hit', (evt) => {
      if (!state.capturingZone && ZONES.includes(evt.zone)) flashZoneTest(evt.zone);
    });

    const offRaw = bus.on('input:raw', onRaw);
    const offConnect = bus.on('input:gamepadconnected', refreshGamepad);
    const offDisconnect = bus.on('input:gamepaddisconnected', refreshGamepad);
    const pollId = setInterval(refreshGamepad, 500);

    if (webhid.isSupported()) {
      const btn = h('button', { class: 'btn' }, webhid.isConnected() ? 'WebHID precision mode: on' : 'Enable WebHID precision mode');
      btn.addEventListener('click', async () => {
        try {
          const dev = await webhid.requestTaikoDevice();
          if (dev) btn.textContent = 'WebHID precision mode: on';
        } catch (err) {
          console.warn('[controller-setup] WebHID request failed', err);
        }
      });
      webhidRow.appendChild(btn);
      webhidRow.appendChild(h('span', { class: 'muted' }, 'Chrome/Edge only. Runs alongside normal controller input, not instead of it.'));
    } else {
      webhidRow.appendChild(h('span', { class: 'muted' }, "WebHID precision mode isn't available in this browser (Chrome/Edge only)."));
    }

    const kbRebind = h('button', { class: 'btn' }, 'Rebind hit key…');
    kbRebind.addEventListener('click', () => {
      kbRebind.textContent = 'Press a key…';
      const handler = (e) => {
        e.preventDefault();
        saveKeyboardBindings({ [e.code]: 'generic-hit' });
        kbInfo.textContent = describeKeyboardBindings();
        kbRebind.textContent = 'Rebind hit key…';
        window.removeEventListener('keydown', handler, true);
      };
      window.addEventListener('keydown', handler, true);
    });
    const kbReset = h('button', { class: 'btn' }, 'Reset to Space/Enter');
    kbReset.addEventListener('click', () => {
      resetKeyboardBindings();
      kbInfo.textContent = describeKeyboardBindings();
    });

    refreshGamepad();

    const root = h('div', { class: 'screen' }, [
      h('h1', {}, 'Controller setup'),
      firefoxWarning,
      h('h3', {}, 'Connected devices'),
      devicePicker,
      h('h3', { style: 'margin-top:var(--space-3)' }, 'Drum zones'),
      h('p', { class: 'muted' }, 'Click Rebind, then hit the same physical pad twice to confirm. Any mapped zone flashes and clicks when hit, so you can test it right here.'),
      zoneGrid,
      h('h3', { style: 'margin-top:var(--space-3)' }, 'Raw input monitor'),
      rawMonitor,
      h('h3', { style: 'margin-top:var(--space-3)' }, 'Precision mode'),
      webhidRow,
      h('h3', { style: 'margin-top:var(--space-3)' }, 'Keyboard fallback'),
      h('div', { class: 'row row-wrap' }, [kbInfo, kbRebind, kbReset]),
    ]);
    container.appendChild(root);

    return () => {
      offRaw();
      offHit();
      offConnect();
      offDisconnect();
      clearInterval(pollId);
      clearTimeout(testFlashTimer);
      clearTimeout(flashDeviceTimer);
      setCaptureMode(false);
    };
  },
};
