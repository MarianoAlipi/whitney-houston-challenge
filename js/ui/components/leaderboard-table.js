import { h, fmtSeconds } from '../../core/dom.js';

const RANK_MEDAL = { 1: 'rank-gold', 2: 'rank-silver', 3: 'rank-bronze' };

export function renderLeaderboard(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'No scored attempts yet.');

  return h(
    'div',
    { class: 'stack leaderboard-list' },
    rows.map((row, i) => {
      const rank = i + 1;
      const medalClass = RANK_MEDAL[rank];
      const tierColor = `var(--tier-${row.best.color ?? 'miss'})`;
      return h('div', { class: 'leaderboard-row' }, [
        h('div', { class: `leaderboard-rank${medalClass ? ` ${medalClass}` : ''}` }, String(rank)),
        h('div', { class: 'leaderboard-name' }, row.player.name),
        h('div', { class: 'leaderboard-score' }, [
          h('span', { class: 'num', style: `color:${tierColor}` }, fmtSeconds(row.best.errorMs)),
          h('span', { class: 'leaderboard-grade', style: `color:${tierColor}` }, row.best.grade),
        ]),
        h('div', { class: 'pill' }, `${row.attempts} attempt${row.attempts === 1 ? '' : 's'}`),
      ]);
    })
  );
}
