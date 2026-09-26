import { h, clear, fmtSeconds } from '../../core/dom.js';
import { unlockAudio } from '../../core/clock.js';
import { bus } from '../../core/events.js';
import { loadPresets, getEffectiveDropAt } from '../../game/targets.js';
import { YouTubeSource } from '../../sources/youtube.js';
import { createLocalSource } from '../../sources/localfile.js';
import { Round } from '../../game/round.js';
import { SimultaneousRound } from '../../game/simultaneous-round.js';
import { mountRunScreen } from '../components/run-screen.js';
import { renderMarkTargetPanel } from '../components/mark-target-panel.js';
import { renderLeaderboard } from '../components/leaderboard-table.js';
import { renderSongPicker } from '../components/song-picker.js';
import { party } from '../../game/party.js';
import { listConnectedGamepads } from '../../input/gamepad.js';
import { deviceKeyOf, ZONES } from '../../input/bindings.js';
import * as store from '../../core/store.js';

export default {
  async mount(container) {
    let presetsCache = [];
    try {
      presetsCache = await loadPresets();
    } catch (err) {
      console.error('[party] failed to load presets', err);
    }

    let session = null; // { source, preset, dropAt, targetMarked, videoWrap, panel, sideboard }
    let turnQueue = [];
    let unmountRun = null;
    let volume = store.get('ui:volume', 100);

    const root = h('div', { class: 'screen' });
    container.appendChild(root);

    renderSetup();

    function renderSetup() {
      clear(root);

      const nameInput = h('input', { type: 'text', placeholder: 'Player name' });
      const addPlayer = () => {
        if (nameInput.value.trim()) {
          party.addPlayer(nameInput.value.trim());
          nameInput.value = '';
          renderSetup();
        }
      };
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addPlayer();
      });
      const addBtn = h('button', { class: 'btn', onClick: addPlayer }, 'Add player');

      const rosterList = h(
        'div',
        { class: 'stack' },
        party.roster.length
          ? party.roster.map((p) =>
              h('div', { class: 'row' }, [
                h('span', { class: 'spacer' }, p.name),
                h('button', { class: 'btn', onClick: () => { party.removePlayer(p.id); renderSetup(); } }, 'Remove'),
              ])
            )
          : [h('p', { class: 'muted' }, 'No players yet.')]
      );

      const turnModeSelect = h(
        'select',
        {},
        [
          h('option', { value: 'sequential' }, 'Turn-based (pass one drum)'),
          h('option', { value: 'simultaneous' }, 'Simultaneous (everyone at once)'),
        ]
      );
      turnModeSelect.value = party.settings.turnMode;
      turnModeSelect.addEventListener('change', () => {
        party.updateSettings({ turnMode: turnModeSelect.value });
        renderSetup();
      });

      const attemptsSelect = h('select', {}, [1, 3, 5].map((n) => h('option', { value: n }, `${n} attempt${n > 1 ? 's' : ''}`)));
      attemptsSelect.value = String(party.settings.attempts);
      attemptsSelect.addEventListener('change', () => party.updateSettings({ attempts: Number(attemptsSelect.value) }));

      const zoneSplitCheckbox = h('input', { type: 'checkbox' });
      zoneSplitCheckbox.checked = party.settings.zoneSplit;
      zoneSplitCheckbox.addEventListener('change', () => {
        party.updateSettings({ zoneSplit: zoneSplitCheckbox.checked });
        renderSetup();
      });

      const exportBtn = h('button', { class: 'btn' }, 'Export data');
      exportBtn.addEventListener('click', downloadExport);
      const importInput = h('input', { type: 'file', accept: 'application/json', style: 'max-width:220px' });
      importInput.addEventListener('change', async () => {
        const f = importInput.files[0];
        if (!f) return;
        store.importJSON(await f.text());
        renderSetup();
      });

      root.appendChild(h('h1', {}, 'Party mode'));

      root.appendChild(h('h3', {}, 'Players'));
      root.appendChild(h('div', { class: 'row' }, [nameInput, addBtn]));
      root.appendChild(rosterList);

      root.appendChild(h('h3', { style: 'margin-top:var(--space-3)' }, 'Settings'));
      root.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Turn flow'), turnModeSelect]));
      root.appendChild(h('div', { class: 'field' }, [h('label', {}, 'Attempts per turn'), attemptsSelect]));
      root.appendChild(
        h('div', { class: 'row' }, [zoneSplitCheckbox, h('label', { style: 'margin:0' }, 'Zone-split (share one drum across up to 4 players)')])
      );
      if (party.settings.turnMode === 'simultaneous') root.appendChild(renderAssignmentUI());

      root.appendChild(h('h3', { style: 'margin-top:var(--space-3)' }, 'Song'));
      const pickerHost = h('div');
      root.appendChild(pickerHost);
      renderSongPicker(pickerHost, {
        presets: presetsCache,
        actionLabel: 'Start party',
        validate: () => {
          if (party.roster.length === 0) return 'Add at least one player first.';
          if (party.settings.turnMode === 'simultaneous') {
            const assignments = party.settings.assignments || {};
            const missing = party.roster.filter((p) => !assignments[p.id]?.deviceId);
            if (missing.length) return `Assign a device to: ${missing.map((p) => p.name).join(', ')}`;
          }
          return null;
        },
        onChoose: async ({ preset, file }) => {
          await unlockAudio();
          turnQueue = [];
          await startSession(preset, file);
        },
      });

      root.appendChild(h('h3', { style: 'margin-top:var(--space-3)' }, 'Leaderboard'));
      root.appendChild(renderLeaderboard(party.leaderboard()));
      root.appendChild(
        h('div', { class: 'row row-wrap' }, [
          h('button', { class: 'btn', onClick: () => { party.resetResults(); renderSetup(); } }, 'Reset leaderboard'),
          exportBtn,
          importInput,
        ])
      );
    }

    function renderAssignmentUI() {
      const pads = listConnectedGamepads();
      const deviceOptions = [{ value: 'keyboard', label: 'Keyboard' }, ...pads.map((p) => ({ value: deviceKeyOf(p), label: `Drum (${deviceKeyOf(p)})` }))];
      const assignments = party.settings.assignments || {};

      const rows = party.roster.map((p) => {
        const deviceSelect = h('select', {}, deviceOptions.map((o) => h('option', { value: o.value }, o.label)));
        deviceSelect.value = assignments[p.id]?.deviceId || 'keyboard';
        const zoneSelect = party.settings.zoneSplit
          ? h('select', {}, [h('option', { value: '' }, 'any zone'), ...ZONES.map((z) => h('option', { value: z }, z))])
          : null;
        if (zoneSelect) zoneSelect.value = assignments[p.id]?.zone || '';
        const save = () => {
          const next = { ...assignments, [p.id]: { deviceId: deviceSelect.value, zone: zoneSelect ? zoneSelect.value || null : null } };
          party.updateSettings({ assignments: next });
        };
        deviceSelect.addEventListener('change', save);
        zoneSelect?.addEventListener('change', save);
        return h('div', { class: 'row' }, [h('span', { class: 'spacer' }, p.name), deviceSelect, zoneSelect].filter(Boolean));
      });

      return h('div', { class: 'card stack' }, [
        h('strong', {}, 'Assign a device to each player'),
        pads.length ? null : h('p', { class: 'muted' }, 'No controller detected. Hit a drum pad to connect one, or use the keyboard.'),
        ...rows,
      ].filter(Boolean));
    }

    function downloadExport() {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'whitney-houston-challenge-data.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function startSession(preset, file) {
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
      const panel = h('div', { class: 'stack', style: 'margin-top:1rem' }, [h('p', { class: 'muted' }, 'Loading…')]);
      const sideboard = h('div', { class: 'party-sidebar' });
      const layout = h('div', { class: 'party-layout' }, [h('div', { class: 'party-main' }, [videoWrap, volumeRow, panel]), sideboard]);
      root.appendChild(layout);

      const source = preset.source === 'youtube' ? new YouTubeSource(mediaContainer) : createLocalSource(file, mediaContainer);

      try {
        if (preset.source === 'youtube') await source.load({ youtubeId: preset.youtubeId, durationSec: preset.approxDurationSec });
        else await source.load(file);
      } catch (err) {
        clear(root);
        root.appendChild(h('p', {}, `Could not load that: ${err.message}`));
        root.appendChild(h('button', { class: 'btn', onClick: renderSetup }, 'Back'));
        return;
      }
      source.setVolume(volume);

      const mediaEl = source.getMediaElement();
      if (!mediaEl) {
        clear(videoWrap);
        videoWrap.appendChild(h('div', { class: 'listen-state' }, '♪ audio only'));
      }

      session = { source, preset, videoWrap, panel, sideboard };
      refreshSideboard();
      const { dropAt, targetMarked } = getEffectiveDropAt(preset);
      if (dropAt == null) {
        renderMarkTargetPanel(session.panel, session.source, session.preset, (median) => {
          session.dropAt = median;
          session.targetMarked = true;
          prepareNext();
        });
      } else {
        session.dropAt = dropAt;
        session.targetMarked = targetMarked;
        prepareNext();
      }
    }

    // Every player's recorded attempts, with a way to erase one, plus a way
    // to queue up an out-of-turn extra go or a redo of the last attempt.
    // Redo/extra-turn only ever push/unshift onto turnQueue rather than
    // touching whatever is currently on screen, so they can never discard a
    // turn that's already mid-display waiting to start.
    function renderAttemptsHistory() {
      if (!party.roster.length) return null;
      return h(
        'div',
        { class: 'stack' },
        party.roster.map((p) => {
          const attempts = party.results[p.id] ?? [];
          return h('div', { class: 'card stack' }, [
            h('div', { class: 'row' }, [
              h('strong', { class: 'spacer' }, p.name),
              h('button', { class: 'btn', onClick: () => { giveExtraTurn(p); } }, '+ turn'),
              attempts.length ? h('button', { class: 'btn', onClick: () => redoLastAttempt(p) }, 'Redo last') : null,
            ].filter(Boolean)),
            attempts.length
              ? h(
                  'div',
                  { class: 'stack' },
                  attempts.map((r, idx) =>
                    h('div', { class: 'row' }, [
                      h('span', { class: 'muted spacer num' }, r.noHit ? 'no hit' : `${r.grade} · ${fmtSeconds(r.errorMs)}`),
                      h('button', { class: 'btn', style: 'padding:0.3em 0.7em', onClick: () => { party.removeAttempt(p.id, idx); refreshSideboard(); } }, '✕'),
                    ])
                  )
                )
              : h('p', { class: 'muted' }, 'No attempts yet.'),
          ]);
        })
      );
    }

    function giveExtraTurn(player) {
      turnQueue.push({ playerId: player.id, attemptIndex: party.attemptsSoFar(player.id) });
    }

    function redoLastAttempt(player) {
      const attempts = party.results[player.id] ?? [];
      if (!attempts.length) return;
      const lastIndex = attempts.length - 1;
      party.removeAttempt(player.id, lastIndex);
      turnQueue.unshift({ playerId: player.id, attemptIndex: lastIndex });
      refreshSideboard();
    }

    function refreshSideboard() {
      clear(session.sideboard);
      session.sideboard.appendChild(h('h3', {}, 'Leaderboard'));
      session.sideboard.appendChild(renderLeaderboard(party.leaderboard()));
      session.sideboard.appendChild(h('h3', { style: 'margin-top:1.5rem' }, 'Attempts'));
      const history = renderAttemptsHistory();
      if (history) session.sideboard.appendChild(history);
      session.sideboard.appendChild(h('button', { class: 'btn', style: 'margin-top:1rem', onClick: endParty }, 'End party'));
    }

    function endParty() {
      session?.source?.destroy();
      session = null;
      renderSetup();
    }

    function buildTurnQueue() {
      const queue = [];
      for (let round = 0; round < party.settings.attempts; round++) {
        for (const p of party.roster) queue.push({ playerId: p.id, attemptIndex: round });
      }
      return queue;
    }

    function prepareNext() {
      if (party.settings.turnMode === 'simultaneous') {
        prepareSimultaneousRound();
        return;
      }
      if (!turnQueue.length) turnQueue = buildTurnQueue();
      const next = turnQueue.shift();
      clear(session.panel);
      if (!next) {
        session.panel.appendChild(h('h3', {}, 'All turns complete.'));
        session.panel.appendChild(
          h('button', { class: 'btn btn-primary btn-lg', onClick: () => { turnQueue = buildTurnQueue(); prepareNext(); } }, 'Play another round')
        );
        return;
      }
      const player = party.roster.find((p) => p.id === next.playerId);
      if (!player) {
        prepareNext();
        return;
      }
      session.panel.appendChild(h('h2', {}, `Up next: ${player.name}`));
      session.panel.appendChild(h('p', { class: 'muted' }, `Attempt ${next.attemptIndex + 1} of ${party.settings.attempts}`));
      session.panel.appendChild(h('div', { class: 'row' }, [
        h('button', { class: 'btn btn-primary btn-lg', onClick: () => startTurn(player, next.attemptIndex) }, 'Go'),
        h('button', { class: 'btn', onClick: () => prepareNext() }, 'Skip this turn'),
      ]));
    }

    function startTurn(player, attemptIndex) {
      clear(session.panel);
      const round = new Round(session.source, { dropAt: session.dropAt, targetMarked: session.targetMarked, showApproach: false });
      unmountRun = mountRunScreen(session.panel, {
        round,
        playerLabel: player.name,
        attemptLabel: `attempt ${attemptIndex + 1} of ${party.settings.attempts}`,
        onComplete: (result) => {
          unmountRun?.();
          unmountRun = null;
          round.destroy();
          party.recordAttempt(player.id, result);
          refreshSideboard();
          prepareNext();
        },
      });
      round.arm();
    }

    function prepareSimultaneousRound() {
      clear(session.panel);
      session.panel.appendChild(h('h2', {}, 'Everyone ready?'));
      session.panel.appendChild(h('p', { class: 'muted' }, 'Every assigned player hits at once, each getting their own result.'));
      session.panel.appendChild(h('button', { class: 'btn btn-primary btn-lg', onClick: startSimultaneousRound }, 'Go'));
    }

    function startSimultaneousRound() {
      clear(session.panel);
      const assignments = party.settings.assignments || {};
      const participants = party.roster.map((p) => ({
        playerId: p.id,
        name: p.name,
        deviceId: assignments[p.id]?.deviceId,
        zone: assignments[p.id]?.zone || null,
      }));

      const round = new SimultaneousRound(session.source, { dropAt: session.dropAt, targetMarked: session.targetMarked, participants });

      const rows = new Map();
      const list = h('div', { class: 'stack' });
      for (const p of participants) {
        const status = h('span', { class: 'muted' }, 'waiting…');
        list.appendChild(h('div', { class: 'row' }, [h('span', { class: 'spacer' }, p.name), status]));
        rows.set(p.playerId, status);
      }
      session.panel.appendChild(h('div', { class: 'listen-state' }, 'listen'));
      session.panel.appendChild(list);

      const offParticipant = bus.on('round:participant-result', (r) => {
        const status = rows.get(r.playerId);
        if (status) status.textContent = r.noHit ? 'no hit' : `${r.grade} (${fmtSeconds(r.errorMs)})`;
      });
      const offResult = bus.on('round:multiresult', ({ results }) => {
        offParticipant();
        offResult();
        // results now always has one entry per participant (see
        // SimultaneousRound._closeWindow); stragglers get a noHit entry
        // rather than being silently omitted, so update every row from it.
        for (const r of results) {
          party.recordAttempt(r.playerId, r);
          const status = rows.get(r.playerId);
          if (status) status.textContent = r.noHit ? 'MISS (no hit)' : `${r.grade} (${fmtSeconds(r.errorMs)})`;
        }
        round.destroy();
        refreshSideboard();
        const hitCount = results.filter((r) => !r.noHit).length;
        clear(session.panel);
        session.panel.appendChild(h('h3', {}, `Round complete: ${hitCount}/${results.length} hit in time`));
        session.panel.appendChild(h('button', { class: 'btn btn-primary btn-lg', onClick: prepareSimultaneousRound }, 'Play again'));
      });

      round.arm();
    }

    return () => {
      unmountRun?.();
      session?.source?.destroy();
    };
  },
};
