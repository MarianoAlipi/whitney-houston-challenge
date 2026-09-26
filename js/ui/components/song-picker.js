import { h, clear } from '../../core/dom.js';
import { parseYouTubeInput, makeAdHocPreset, makeLocalFilePreset } from '../../game/targets.js';

const thumbnailUrl = (youtubeId) => `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;

// Renders a featured song as a real card (thumbnail + title + one button)
// instead of a dropdown with one boring option, plus a collapsed "use a
// different source" section for the paste-a-link / local-file paths from
// the original brief. `validate()` (optional) runs before onChoose fires:
// return an error string to block and display it (e.g. "add a player
// first"), or null/undefined to proceed.
export function renderSongPicker(container, { presets, onChoose, validate, actionLabel = 'Continue' }) {
  clear(container);
  const featured = presets[0];
  const errorBox = h('p', { class: 'muted' }, '');

  function attemptChoose(payload) {
    const err = validate?.();
    if (err) {
      errorBox.textContent = err;
      return;
    }
    errorBox.textContent = '';
    onChoose(payload);
  }

  const card = featured
    ? h('div', { class: 'song-card' }, [
        h('img', { src: thumbnailUrl(featured.youtubeId), alt: '', class: 'song-card-thumb' }),
        h('div', { class: 'song-card-body' }, [
          h('div', { class: 'song-card-title' }, featured.title),
          h(
            'button',
            { class: 'btn btn-primary btn-lg', onClick: () => attemptChoose({ preset: featured }) },
            actionLabel
          ),
        ]),
      ])
    : null;

  const urlInput = h('input', { type: 'url', placeholder: 'paste any YouTube link' });
  const fileInput = h('input', { type: 'file', accept: 'audio/*,video/*' });

  const custom = h('details', { class: 'song-custom' }, [
    h('summary', {}, 'Use a different YouTube link or a local file'),
    h('div', { class: 'stack', style: 'margin-top:1rem' }, [
      h('div', { class: 'field' }, [h('label', {}, 'Paste a YouTube link'), urlInput]),
      h('div', { class: 'field' }, [h('label', {}, 'Or a local audio/video file'), fileInput]),
      h(
        'button',
        {
          class: 'btn',
          onClick: () => {
            const file = fileInput.files[0];
            if (file) {
              attemptChoose({ preset: makeLocalFilePreset(file), file });
              return;
            }
            if (urlInput.value.trim()) {
              const id = parseYouTubeInput(urlInput.value);
              if (!id) {
                errorBox.textContent = 'Could not read a YouTube video ID from that link.';
                return;
              }
              attemptChoose({ preset: makeAdHocPreset(id) });
              return;
            }
            errorBox.textContent = 'Paste a link or choose a file first.';
          },
        },
        actionLabel
      ),
    ]),
  ]);

  container.appendChild(h('div', { class: 'stack' }, [card, custom, errorBox].filter(Boolean)));
}
