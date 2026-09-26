// Party mode model: roster, settings (turn mode / attempts / zone-split),
// per-player results, and the leaderboard. Pure state + persistence; screens
// wire it to the UI.
import * as store from '../core/store.js';
import { bus } from '../core/events.js';

export class Party {
  constructor() {
    this.roster = store.get('party:roster', []); // [{id, name}]
    this.settings = store.get('party:settings', {
      turnMode: 'sequential', // 'sequential' | 'simultaneous'
      attempts: 1, // 1 | 3 | 5, best counts
      zoneSplit: false, // share one drum across up to 4 players via its 4 zones
    });
    this.results = store.get('party:results', {}); // playerId -> [{errorMs, grade, absMs, confidence, at}]
  }

  addPlayer(name) {
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.roster.push({ id, name });
    this.results[id] = this.results[id] || [];
    this._persist();
    return id;
  }

  removePlayer(id) {
    this.roster = this.roster.filter((p) => p.id !== id);
    delete this.results[id];
    this._persist();
  }

  renamePlayer(id, name) {
    const p = this.roster.find((p) => p.id === id);
    if (p) {
      p.name = name;
      this._persist();
    }
  }

  updateSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    this._persist();
  }

  recordAttempt(playerId, result) {
    if (!this.results[playerId]) this.results[playerId] = [];
    this.results[playerId].push({ ...result, at: new Date().toISOString() });
    this._persist();
  }

  attemptsSoFar(playerId) {
    return this.results[playerId]?.length ?? 0;
  }

  removeAttempt(playerId, index) {
    if (!this.results[playerId]) return;
    this.results[playerId].splice(index, 1);
    this._persist();
  }

  clearPlayerAttempts(playerId) {
    if (!this.results[playerId]) return;
    this.results[playerId] = [];
    this._persist();
  }

  bestResult(playerId) {
    // Filter out no-hit attempts (absMs: null) *before* reducing. null < N
    // coerces to 0 < N, which is true for any positive score, so an
    // unfiltered reduce would make "never hit it" rank as a perfect score.
    const list = (this.results[playerId] ?? []).filter((r) => r.absMs != null);
    if (!list.length) return null;
    return list.reduce((best, r) => (r.absMs < best.absMs ? r : best), list[0]);
  }

  leaderboard() {
    return this.roster
      .map((player) => ({ player, best: this.bestResult(player.id), attempts: this.attemptsSoFar(player.id) }))
      .filter((row) => row.best)
      .sort((a, b) => a.best.absMs - b.best.absMs);
  }

  resetResults() {
    this.results = {};
    this._persist();
  }

  clearRoster() {
    this.roster = [];
    this.results = {};
    this._persist();
  }

  _persist() {
    store.set('party:roster', this.roster);
    store.set('party:settings', this.settings);
    store.set('party:results', this.results);
    bus.emit('party:update', {});
  }
}

// One party per session is all this app needs, so screens import this directly.
export const party = new Party();
