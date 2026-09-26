import { h, clear, fmtMs } from '../../core/dom.js';
import { unlockAudio } from '../../core/clock.js';
import {
  runCalibrationWizard,
  saveCalibrationProfile,
  listCalibrationProfiles,
  getActiveProfileName,
  setActiveCalibrationProfile,
  deleteCalibrationProfile,
} from '../../audio/calibration.js';

export default {
  mount(container) {
    const beatDots = h('div', { class: 'row row-wrap' });
    const status = h('p', { class: 'muted' }, "You'll hear 20 beeps. Tap your drum in time with them, and don't react to your own hit, just keep the beat.");
    const scatter = h('div', { class: 'scatter' }, [h('div', { class: 'zero-line' })]);
    const resultBox = h('div', {});
    const profileList = h('div', { class: 'stack' });

    function renderProfiles() {
      clear(profileList);
      const profiles = listCalibrationProfiles();
      const active = getActiveProfileName();
      const names = Object.keys(profiles);
      if (!names.length) {
        profileList.appendChild(h('p', { class: 'muted' }, 'No saved profiles yet.'));
        return;
      }
      for (const name of names) {
        const p = profiles[name];
        profileList.appendChild(
          h('div', { class: 'row card', style: 'margin-bottom:0.75rem' }, [
            h('div', { class: 'spacer' }, [
              h('strong', {}, name + (name === active ? ' (active)' : '')),
              h('div', { class: 'muted' }, `${p.deviceKey ?? 'unknown device'} · offset ${fmtMs(p.offsetMs)}`),
            ]),
            h(
              'button',
              { class: 'btn', onClick: () => { setActiveCalibrationProfile(name); renderProfiles(); } },
              'Use'
            ),
            h(
              'button',
              { class: 'btn', onClick: () => { deleteCalibrationProfile(name); renderProfiles(); } },
              'Delete'
            ),
          ])
        );
      }
    }

    const startBtn = h('button', { class: 'btn btn-primary btn-lg' }, 'Start calibration (~10s)');
    startBtn.addEventListener('click', async () => {
      await unlockAudio();
      startBtn.disabled = true;
      status.textContent = 'Listen and tap along…';
      clear(beatDots);
      clear(scatter);
      scatter.appendChild(h('div', { class: 'zero-line' }));
      clear(resultBox);
      for (let i = 0; i < 20; i++) beatDots.appendChild(h('span', { class: 'metronome-beat' }));

      runCalibrationWizard({
        onBeat: (i) => {
          [...beatDots.children].forEach((el, idx) => el.classList.toggle('active', idx === i));
        },
        onDone: (result) => {
          startBtn.disabled = false;
          status.textContent = "You'll hear 20 beeps. Tap your drum in time with them, and don't react to your own hit, just keep the beat.";
          renderResult(result);
        },
      });
    });

    function renderResult(result) {
      clear(scatter);
      scatter.appendChild(h('div', { class: 'zero-line' }));
      for (const p of result.points) {
        const pct = 50 + Math.max(-50, Math.min(50, (p.errMs / 200) * 50));
        scatter.appendChild(h('div', { class: `dot${p.rejected ? ' rejected' : ''}`, style: `left:${pct}%;top:50%` }));
      }

      clear(resultBox);
      if (!result.ok) {
        const reasons = {
          'no-taps': 'No hits were detected. Check your controller on the Controller Setup screen first.',
          'too-few-taps': 'Not enough consistent taps came through. Try tapping more steadily, right through all 20 beeps.',
          inconsistent: "Your taps were too spread out to trust. Try relaxing and tapping right on the beep rather than reacting to it.",
        };
        resultBox.appendChild(h('p', {}, reasons[result.reason] || 'Calibration did not pass.'));
        resultBox.appendChild(h('button', { class: 'btn', onClick: () => startBtn.click() }, 'Try again'));
        return;
      }

      const nameInput = h('input', { type: 'text', placeholder: 'e.g. Living room TV', value: 'My setup' });
      const saveBtn = h('button', { class: 'btn btn-primary' }, 'Save this profile');
      saveBtn.addEventListener('click', () => {
        saveCalibrationProfile(nameInput.value || 'My setup', result.deviceKeyUsed, result.offsetMs);
        renderProfiles();
      });
      resultBox.appendChild(
        h('div', { class: 'stack' }, [
          h('p', {}, [
            'Measured offset: ',
            h('strong', { class: 'num' }, fmtMs(result.offsetMs)),
            ` (±${result.robustSdMs.toFixed(0)}ms, ${result.nKept}/${result.nTotal} taps used)`,
          ]),
          h('div', { class: 'field' }, [h('label', {}, 'Profile name'), nameInput]),
          saveBtn,
        ])
      );
    }

    renderProfiles();

    const root = h('div', { class: 'screen screen-narrow' }, [
      h('h1', {}, 'Calibrate'),
      h(
        'p',
        { class: 'muted' },
        'Measures your total audio and input delay (TV, soundbar, Bluetooth, everything) with one silent tap test. It never plays a sound when you hit; only listen to the beeps.'
      ),
      h(
        'div',
        { class: 'card' },
        "For a TV: turn on Game Mode / ALLM and set audio output to PCM/stereo rather than a bitstreamed format (Dolby Atmos etc.). That alone can remove 60-130ms."
      ),
      startBtn,
      beatDots,
      status,
      scatter,
      resultBox,
      h('hr'),
      h('h3', {}, 'Saved profiles'),
      profileList,
    ]);
    container.appendChild(root);
  },
};
