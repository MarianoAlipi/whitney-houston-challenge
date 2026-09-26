// Optional opt-in "precision mode": Chrome/Edge only, requires HTTPS (or
// localhost) + a user gesture + an explicit device picker. Confirmed safe to
// run alongside the Gamepad API on the same device: a Generic Desktop/Game
// Pad collection is not in Chromium's protected-usage list, and Chromium
// opens HID with kIOHIDOptionsTypeNone on macOS / FILE_SHARE_READ|WRITE on
// Windows, so it does not seize the device.
//
// The 8-byte input report has no report ID. Bits 6/7/10/11 of the first
// 16-bit field are ka-left/ka-right/don-left/don-right, the same mapping
// bindings.js ships as the Gamepad API default, so no user mapping step is
// needed here; this is specifically the known device, not a generic pad.
const TAIKO_VID = 0x0f0d;
const TAIKO_PID = 0x00f0;
const BIT_ZONE = { 6: 'ka-left', 7: 'ka-right', 10: 'don-left', 11: 'don-right' };

let device = null;
let prevBits = 0;
let onRaw = null;

export function isSupported() {
  return 'hid' in navigator;
}

export async function requestTaikoDevice() {
  if (!isSupported()) throw new Error('WebHID is not supported in this browser.');
  const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: TAIKO_VID, productId: TAIKO_PID }] });
  if (!picked || !picked.length) return null;
  device = picked[0];
  if (!device.opened) await device.open();
  device.addEventListener('inputreport', handleReport);
  return device;
}

function handleReport(event) {
  const { data } = event;
  if (data.byteLength < 2) return;
  const bits = data.getUint16(0, true);
  const changed = bits ^ prevBits;
  const now = performance.now();
  for (const [bitStr, zone] of Object.entries(BIT_ZONE)) {
    const mask = 1 << Number(bitStr);
    if (changed & mask && bits & mask) {
      onRaw?.({ device: 'webhid', kind: 'bit', index: Number(bitStr), zone, timestamp: now });
    }
  }
  prevBits = bits;
}

// Registers the callback; harmless to call before a device is connected,
// reports simply won't arrive yet.
export function startWebHidListening(reportRaw) {
  onRaw = reportRaw;
}

export async function disconnectTaikoDevice() {
  device?.removeEventListener('inputreport', handleReport);
  if (device?.opened) await device.close();
  device = null;
}

export function isConnected() {
  return device !== null && device.opened;
}

export function currentDevice() {
  return device;
}
