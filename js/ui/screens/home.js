import { h } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { ICONS } from '../components/icons.js';

function navCard(icon, title, desc, onClick) {
  return h('button', { class: 'nav-card', onClick }, [
    h('div', { class: 'nav-card-icon', html: icon }),
    h('h3', {}, title),
    h('p', {}, desc),
  ]);
}

export default {
  mount(container) {
    const root = h('div', { class: 'screen' }, [
      h('h1', {}, 'Whitney Houston Challenge'),
      h('p', { class: 'muted', style: 'margin:0.5rem 0 2rem' }, 'Hit the drum the instant the beat drops after the pause.'),
      h('div', { class: 'nav-grid' }, [
        navCard(ICONS.play, 'Play', 'A YouTube preset or your own file, for practice or a straight challenge run.', () => navigate('play')),
        navCard(ICONS.party, 'Party', 'Add names, take turns or play together, watch the leaderboard.', () => navigate('party')),
        navCard(ICONS.calibrate, 'Calibrate', 'A short silent beep test to correct for TV/speaker delay.', () => navigate('calibrate')),
        navCard(ICONS.controller, 'Controller', 'Set up and remap your Taiko drum or the keyboard fallback.', () => navigate('controller')),
      ]),
    ]);
    container.appendChild(root);
  },
};
