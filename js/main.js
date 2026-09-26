import { register, start } from './core/router.js';
import { startInputBus } from './input/inputbus.js';
import { tick } from './core/clock.js';
import { mountDebugOverlay } from './ui/components/debug-overlay.js';

import home from './ui/screens/home.js';
import play from './ui/screens/play.js';
import partyScreen from './ui/screens/party-screen.js';
import calibrate from './ui/screens/calibrate.js';
import controllerSetup from './ui/screens/controller-setup.js';

register('home', home);
register('play', play);
register('party', partyScreen);
register('calibrate', calibrate);
register('controller', controllerSetup);

startInputBus();
mountDebugOverlay();

// Keeps the performance.now() <-> AudioContext.currentTime correlation warm
// (core/clock.js). Cheap no-op until the first user gesture creates an
// AudioContext.
(function loop() {
  tick();
  requestAnimationFrame(loop);
})();

start(document.getElementById('app'), 'home');
