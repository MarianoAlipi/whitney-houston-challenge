// Small hand-drawn line icons, no icon library. Stroke-based to match the
// hairline-rule aesthetic; colour only on the brand mark, which deliberately
// mirrors a taiko drum face (ka-blue rim, don-red centre) since that's the
// one piece of "logo" this app actually has a right to.
export const ICONS = {
  brand: `<svg viewBox="0 0 28 28" width="26" height="26" fill="none"><circle cx="14" cy="14" r="12" stroke="var(--ka)" stroke-width="2.2"/><circle cx="14" cy="14" r="6.2" fill="var(--don)"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.25"/><path d="M10 8.3l6.2 3.7-6.2 3.7z" fill="currentColor" stroke="none"/></svg>`,
  party: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="3"/><circle cx="17" cy="9.5" r="2.3"/><path d="M2.8 20c0-3.3 2.4-5.6 5.7-5.6s5.7 2.3 5.7 5.6"/><path d="M15 20c.2-2.5 1.8-4.3 3.9-4.7"/></svg>`,
  calibrate: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5h3.6l1.8 6.5L11.2 4l3 15 1.8-6.5H22"/></svg>`,
  controller: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="7.8" width="19.4" height="10.4" rx="4.3"/><path d="M7.6 10.9v4.2M5.5 13h4.2"/><circle cx="16.1" cy="11.6" r="1"/><circle cx="18.6" cy="14.3" r="1"/></svg>`,
};
