# Whitney Houston Challenge

A browser game for the "Whitney Houston challenge": hit a drum the exact instant the beat
drops after the a-cappella pause in *I Will Always Love You*. Built for a Taiko no Tatsujin
Nintendo Switch drum controller over USB, played on a TV, on Windows and macOS, but a keyboard
works too.

No npm, no build step, no bundler. Plain HTML/CSS/ES modules, loaded directly by the browser.

## Running locally

Open `index.html` directly (`file://`) **will not work**: the YouTube embed's postMessage
handshake and native ES module imports both require an actual HTTP origin. Serve the folder
instead:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. `localhost` counts as a secure context, so the Gamepad API and
the optional WebHID precision mode both work in dev exactly as they will once deployed.

## How it's put together

- `index.html`, `css/`: no framework, hand-written CSS with design tokens in `css/tokens.css`.
- `js/core/`: event bus, namespaced localStorage wrapper, hash router, the shared
  `performance.now() <-> AudioContext.currentTime` clock correlation (`clock.js`, the single most
  important file in the app; every timing number the game reports depends on it being identical in
  the calibration wizard and in gameplay).
- `js/sources/`: YouTube and local-file playback, both exposing the same `mediaTimeAt(perfMs)`
  contract so the rest of the app doesn't care which one is active.
- `js/input/`: Gamepad API polling (with a shipped default mapping for the Taiko drum, VID
  `0x0f0d` / PID `0x00f0`), keyboard fallback, an optional WebHID "precision mode", and the
  remapping/persistence logic.
- `js/audio/`: the calibration wizard (median + MAD outlier rejection over a 20-beep silent tap
  test) and a procedurally-generated click, so no audio assets are shipped at all.
- `js/game/`: the timing model (`round.js`, `simultaneous-round.js`), scoring (`judge.js`), the
  "mark the drop" flow (`mark-target.js`), song presets (`targets.js`), and party mode (`party.js`).
- `js/ui/`: screens and small reusable components, plain DOM via the `h()` helper in `core/dom.js`.

The full design rationale (why the YouTube clock is more precise than its reputation, exactly how
the drum enumerates over USB, the calibration algorithm, and the GitHub Pages constraints) is
written up in the implementation plan this was built from.

## Why some presets are unmeasured

The shipped Whitney Houston preset has a real `dropAt` (189.5s), confirmed by ear against the exact
video it plays. Ad-hoc presets (a pasted YouTube link or a local file) can't get that treatment in
advance, since there's no way to know their timing until you've actually heard them, so those ship
with `dropAt: null` instead of a guess presented as fact. The first time you play one of those, the
app asks you to **mark the drop**: play through it a few times and hit your drum right on the beat.
It keeps the earliest of those reactions as the target, since a surprise reaction can only land
late, never early, which makes the minimum the least-biased estimate.

Marking the target on your own system is actually *more* accurate than a shipped timestamp, because
any error in your calibration offset cancels out exactly when the same offset was in effect at
marking time and at scoring time. It's just not needed for a preset whose drop is already known.
See the confidence badge shown with every result: **HIGH** means the target was marked on this
system with a passing calibration; **MEDIUM** means a verified preset with a passing calibration;
**LOW** covers everything else
(uncalibrated, an inconsistent calibration run, Firefox on macOS, or a clock hiccup during the run).

## Calibrating for a TV

Open **Calibrate** and run the 20-beep tap test. It measures your total audio and input delay (TV,
soundbar, Bluetooth, everything) in one pass and never plays a sound in response to your own hit,
so the measurement isn't contaminated by feedback latency. Before you do: **turn on the TV's Game
Mode / ALLM and set audio output to PCM/stereo rather than a bitstreamed format** (Dolby Atmos,
etc.). That alone commonly removes 60-130ms.

You can save multiple named profiles (e.g. "Living room TV", "Headphones") and switch the active
one from the Calibrate screen.

## Controller setup

Plug in the Taiko drum and hit any pad. Browsers hide gamepads from web pages until you do, as a
fingerprinting mitigation. The default mapping (buttons 6/7/10/11 to ka-left/ka-right/don-left/
don-right) is shipped and should just work. Open **Controller** to remap any zone (hit the same pad
twice to confirm a rebind, which resolves clone controllers that fire both a button and an
axis for one physical hit) or to rebind the keyboard fallback key.

**If you're on Firefox on macOS**, the game will warn you: Firefox hard-codes a 20Hz gamepad poll
on macOS specifically (~25ms average extra input delay, with no fix available from a web page).
Chrome, Edge, or Safari are all fine.

## Party mode

Add names, pick turn-based (pass one drum around) or simultaneous (everyone plays the same
run-through at once, each on their own device, or split one drum's four zones across up to four
players), set attempts per turn (best counts), and go. The leaderboard is local to this browser
(see the limitations below), with export/import to back it up as a JSON file.

## Known limitations (and why)

- **No global/shared leaderboard.** GitHub Pages serves static files only; there's no server to
  hold one. Client-side scores would be trivially forgeable anyway, which is fine for a party game
  but worth knowing.
- **Safari deletes all local storage after 7 days of no interaction with the page** (an Apple ITP
  policy, not something this app can override). Recalibrating takes about 15 seconds, and the
  Export/Import buttons in Party mode let you keep a backup.
- **All of your own `<username>.github.io/*` projects share one storage origin.** This app
  namespaces and versions every key it writes (`whitney:v1:...`) so it can't collide with anything
  else you host there. That's why the namespacing exists, rather than being an oversight.
- **No cross-origin isolation** (GitHub Pages can't set the COOP/COEP headers that would enable it).
  In practice this costs nothing here: it only affects `performance.now()`'s resolution (0.1ms on
  Chrome / 1ms on Firefox and Safari instead of 5µs), which is roughly 30x finer than a person's own
  tap-timing jitter and well under Chrome's 4ms gamepad poll interval. Not worked around on purpose:
  the usual fix (`coi-serviceworker`) force-reloads the page on first visit and would break the
  YouTube embed, which only ever sends a report-only COEP header.
- **The YouTube embed can be casual-great but never esports-precise.** Its own clock reconstructs to
  roughly ±1-2ms, which is *better* than a bare `<video>` element gets you. The embed's audio
  never reaches your speakers through a path this page can measure, though, so absolute accuracy
  still rides on calibration. A local audio file is the more precise path if you want it (see
  below), and is also fully offline-capable.
- **Ads.** YouTube embeds can show pre-roll/post-roll ads with no way to disable them from an embed.
  The one structural mercy: mid-roll ads require at least 8 minutes of runtime, and this song is
  about 4:30, so the drop itself can never be interrupted by one.

## Verifying it actually works

- **Debug overlay**: press the backtick key (`` ` ``) anywhere in the app for a live readout of
  audio clock state, connected gamepads and their raw mapping, the Firefox/macOS warning, and the
  last few raw input events.
- **Clock self-test**: with the debug overlay open during a run, sample residuals should stay in
  the low single-digit milliseconds. Anything like ±50ms means something's wrong with the anchor
  logic, not just "audio is laggy".
- **A synthetic, hardware-free check**: `js/game/judge.js` is pure and stateless, so you can call
  `judge(0)` and expect `{ grade: 'WHITNEY', ... }` in a browser console without touching a
  controller at all, to sanity-check the grading thresholds independently of timing.
- **A real end-to-end check without trusting YouTube**: load a local audio file with a distinct
  click at a known timestamp as a "Local file", mark the target on that click, then try to hit it.
  The reported error should land within a few milliseconds, since the local-audio path is the most
  precise one in the app.

## Deploying to GitHub Pages

This repo is ready to serve as-is (`.nojekyll` is already present, so Jekyll won't silently drop
any file or folder starting with `_` or `.`). Push it to a GitHub repository and enable Pages for
the branch/root. No build step, no Actions workflow required (though one is a fine way to lift the
10-builds/hour soft limit if you deploy often). Nothing has been pushed to a remote yet; that's a
deliberate choice, not an omission.
