import { h, clear, fmtTime } from '../../core/dom.js';
import { unlockAudio } from '../../core/clock.js';
import { loadPresets, getEffectiveDropAt } from '../../game/targets.js';
import { YouTubeSource } from '../../sources/youtube.js';
import { createLocalSource } from '../../sources/localfile.js';
import { Round } from '../../game/round.js';
import { mountRunScreen } from '../components/run-screen.js';
import { renderMarkTargetPanel } from '../components/mark-target-panel.js';
import { renderSongPicker } from '../components/song-picker.js';
import * as store from '../../core/store.js';

const DEFAULT_PLAY_SETTINGS = { showCountdown: true, anticipationGlow: true, metronome: false, metronomeHalfTime: false };

function checkboxRow(label, checked, onChange) {
  const checkbox = h('input', { type: 'checkbox' });
  checkbox.checked = checked;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  return h('div', { class: 'row', style: 'gap:0.5rem' }, [checkbox, h('label', { style: 'margin:0' }, label)]);
}

export default {
  async mount(container) {
    let mode = 'practice'; // 'practice' | 'challenge'
    let session = null; // { source, preset, dropAt, targetMarked, videoWrap, chrome, panel }
    let unmountRun = null;
    let presets = [];
    let playSettings = store.get('ui:playSettings', DEFAULT_PLAY_SETTINGS);
    let volume = store.get('ui:volume', 100);

    const root = h('div', { class: 'screen screen-narrow' });
    container.appendChild(root);

    try {
      presets = await loadPresets();
    } catch (err) {
      console.error('[play] failed to load presets', err);
    }
    renderPicker();

    function updatePlaySetting(key, value) {
      playSettings = { ...playSettings, [key]: value };
      store.set('ui:playSettings', playSettings);
    }

    function renderPicker() {
      root.className = 'screen screen-narrow';
      clear(root);
      const modeToggle = h('div', { class: 'row' }, [
        h('button', { class: `btn ${mode === 'practice' ? 'btn-primary' : ''}`, onClick: () => { mode = 'practice'; renderPicker(); } }, 'Practice'),
        h('button', { class: `btn ${mode === 'challenge' ? 'btn-primary' : ''}`, onClick: () => { mode = 'challenge'; renderPicker(); } }, 'Challenge'),
      ]);
      const settingsRow = h('div', { class: 'row row-wrap', style: 'gap:1.5rem' }, [
        checkboxRow('Show countdown', playSettings.showCountdown, (v) => updatePlaySetting('showCountdown', v)),
        checkboxRow('Anticipation glow', playSettings.anticipationGlow, (v) => updatePlaySetting('anticipationGlow', v)),
        checkboxRow('Metronome', playSettings.metronome, (v) => updatePlaySetting('metronome', v)),
        checkboxRow('Half-time metronome', playSettings.metronomeHalfTime, (v) => updatePlaySetting('metronomeHalfTime', v)),
      ]);

      root.appendChild(h('h1', {}, 'Play'));
      root.appendChild(
        h('p', { class: 'muted' }, mode === 'practice' ? 'Practice shows how close the drop is as it approaches.' : 'Challenge plays audio only, with nothing shown until after you hit.')
      );
      root.appendChild(modeToggle);
      root.appendChild(settingsRow);

      const pickerHost = h('div');
      root.appendChild(pickerHost);
      renderSongPicker(pickerHost, {
        presets,
        actionLabel: 'Play',
        onChoose: async ({ preset, file }) => {
          await unlockAudio();
          await startSession(preset, file);
        },
      });
    }

    async function startSession(preset, file) {
      root.className = 'screen'; // the run view wants more width than the picker does
      clear(root);
      const mediaContainer = h('div');
      const videoWrap = h('div', { class: 'run-video-wrap' }, [mediaContainer]);
      const volumeSlider = h('input', { type: 'range', min: 0, max: 100 });
      volumeSlider.value = String(volume);
      volumeSlider.addEventListener('input', () => {
        volume = Number(volumeSlider.value);
        store.set('ui:volume', volume);
        session?.source?.setVolume(volume);
      });
      // width:min(...) rather than max-width alone: a flex item with an auto
      // margin opts out of stretch-to-fill entirely (see .run-video-wrap in
      // ui.css), so max-width without a definite width was silently
      // shrinking these to their content size instead of the intended cap.
      const volumeRow = h('div', { class: 'row', style: 'width:min(300px,100%);margin:0 auto' }, [h('span', { class: 'muted' }, 'Volume'), volumeSlider]);
      const panel = h('div', { class: 'stack', style: 'width:min(640px,100%);margin:0 auto' }, [h('p', { class: 'muted' }, 'Loading…')]);
      root.appendChild(videoWrap);
      root.appendChild(volumeRow);
      root.appendChild(panel);

      const source = preset.source === 'youtube' ? new YouTubeSource(mediaContainer) : createLocalSource(file, mediaContainer);

      try {
        if (preset.source === 'youtube') {
          await source.load({ youtubeId: preset.youtubeId, durationSec: preset.approxDurationSec });
        } else {
          await source.load(file);
        }
      } catch (err) {
        clear(root);
        root.appendChild(h('p', {}, `Could not load that: ${err.message}`));
        root.appendChild(h('button', { class: 'btn', onClick: renderPicker }, 'Back'));
        return;
      }
      source.setVolume(volume);

      const mediaEl = source.getMediaElement();
      if (!mediaEl) {
        clear(videoWrap);
        videoWrap.appendChild(h('div', { class: 'listen-state' }, '♪ audio only'));
      }

      session = { source, preset, videoWrap, panel };
      const { dropAt, targetMarked } = getEffectiveDropAt(preset);
      if (dropAt == null) {
        renderMarkTargetPanel(session.panel, session.source, session.preset, (median) => {
          session.dropAt = median;
          session.targetMarked = true;
          renderReady();
        });
      } else {
        session.dropAt = dropAt;
        session.targetMarked = targetMarked;
        renderReady();
      }
    }

    function renderReady() {
      clear(session.panel);
      session.panel.appendChild(h('h2', {}, session.preset.title));
      session.panel.appendChild(
        h(
          'p',
          { class: 'muted' },
          `Target set at ${fmtTime(session.dropAt)}. ${mode === 'practice' ? 'An approach indicator will show as it gets close.' : 'Audio only, no visual cue.'}`
        )
      );
      session.panel.appendChild(h('button', { class: 'btn btn-primary btn-lg', onClick: startRound }, 'Go'));
      session.panel.appendChild(
        h(
          'button',
          {
            class: 'btn',
            onClick: () => {
              session.source.destroy();
              session = null;
              renderPicker();
            },
          },
          'Choose a different song'
        )
      );
    }

    function startRound() {
      clear(session.panel);
      const round = new Round(session.source, {
        dropAt: session.dropAt,
        targetMarked: session.targetMarked,
        showApproach: mode === 'practice',
        metronome: playSettings.metronome,
        metronomeHalfTime: playSettings.metronomeHalfTime,
        metronomeOffsetSec: session.preset.metronomeOffsetSec ?? 0,
      });
      unmountRun = mountRunScreen(session.panel, {
        round,
        playerLabel: 'You',
        attemptLabel: null,
        showCountdown: playSettings.showCountdown,
        anticipationGlow: playSettings.anticipationGlow,
        onComplete: () => {
          unmountRun?.();
          unmountRun = null;
          round.destroy();
          renderReady();
        },
      });
      round.arm();
    }

    return () => {
      unmountRun?.();
      session?.source?.destroy();
    };
  },
};
