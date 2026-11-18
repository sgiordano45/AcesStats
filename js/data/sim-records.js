// js/data/sim-records.js
// Backyard Aces Softball (sim.html): each person's record against the
// computer. Signed in, it is kept on their account; signed out, in this
// browser only (localStorage acesSim.record.v1).
//
//   simRecords/{uid}
//     { name, games, wins, losses, ties, runsFor, runsAgainst,
//       streak: { type: 'W'|'L'|'T', n },
//       byStyle: { [CPU_STYLES key]: { w, l, t, firstWinAt } },   // a win = that pennant
//       recent: [{ at, you, cpu, style, conditions, how, team?, opp? }], // newest first, up to RECENT_KEEP
//     Real-team and Season games (style 'teams' / 'season') also carry the two team names.
//     seasonBests: { [teamKey]: { team, w, l, t, rf, ra, at } }   // best Season-mode run with each team
//     seasonsPlayed
//       lastGameAt, updatedAt }

import { db, doc, getDoc, setDoc, serverTimestamp } from '../core/firebase.js';

const LOCAL_KEY = 'acesSim.record.v1';
export const RECENT_KEEP = 10;

/** An empty record. */
export function blankRecord() {
  return { games: 0, wins: 0, losses: 0, ties: 0, runsFor: 0, runsAgainst: 0, streak: { type: '', n: 0 }, byStyle: {}, recent: [], seasonBests: {}, seasonsPlayed: 0 };
}

/** Fill in anything an older or partial record is missing. */
function normalize(r) {
  const b = blankRecord();
  const out = { ...b, ...(r || {}) };
  out.streak = { ...b.streak, ...(r?.streak || {}) };
  out.byStyle = { ...(r?.byStyle || {}) };
  out.recent = Array.isArray(r?.recent) ? r.recent : [];
  out.seasonBests = { ...(r?.seasonBests || {}) };
  return out;
}

/**
 * The record with one more game added. Pure.
 * @param {object} rec    current record
 * @param {object} game   { you, cpu, style, conditions, how, team?, opp? }  (runs for the user and the computer)
 * @returns {{ record: object, newPennant: boolean }}
 */
export function addGame(rec, { you, cpu, style, conditions = '', how = '', team = '', opp = '' }) {
  const r = normalize(JSON.parse(JSON.stringify(rec || {})));
  const result = you > cpu ? 'W' : you < cpu ? 'L' : 'T';
  r.games += 1;
  if (result === 'W') r.wins += 1;
  if (result === 'L') r.losses += 1;
  if (result === 'T') r.ties += 1;
  r.runsFor += you;
  r.runsAgainst += cpu;
  r.streak = r.streak.type === result ? { type: result, n: r.streak.n + 1 } : { type: result, n: 1 };
  const s = r.byStyle[style] || { w: 0, l: 0, t: 0, firstWinAt: null };
  const newPennant = result === 'W' && !s.w;
  if (result === 'W') s.w += 1;
  if (result === 'L') s.l += 1;
  if (result === 'T') s.t += 1;
  if (newPennant) s.firstWinAt = new Date().toISOString();
  r.byStyle[style] = s;
  const names = opp ? { team, opp } : {};
  r.recent = [{ at: new Date().toISOString(), you, cpu, style, conditions, how, ...names }, ...r.recent].slice(0, RECENT_KEEP);
  return { record: r, newPennant };
}

function readLocal() {
  try { return normalize(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')); } catch { return blankRecord(); }
}
function writeLocal(r) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(r)); } catch { /* full or blocked */ }
}

/** The person's record: from their account when signed in, else this browser. */
export async function loadRecord(uid) {
  if (!uid) return readLocal();
  const snap = await getDoc(doc(db, 'simRecords', uid));
  return normalize(snap.exists() ? snap.data() : null);
}

/**
 * Add a finished game and save. Returns { record, newPennant }.
 * Signed in: read, add, write back (one person writes their own doc, so no transaction).
 */
export async function recordGame(uid, game, { name = '' } = {}) {
  return recordGames(uid, [game], { name });
}

/**
 * Add several finished games in one save (a simmed run of Season games).
 * Returns { record, newPennant } (newPennant: the last game earned one).
 */
export async function recordGames(uid, games, { name = '', season = null } = {}) {
  const current = uid ? await loadRecord(uid) : readLocal();
  let out = { record: current, newPennant: false };
  for (const game of games) out = addGame(out.record, game);
  if (season) out.record = addSeason(out.record, season);
  if (!uid) {
    writeLocal(out.record);
    return out;
  }
  await setDoc(doc(db, 'simRecords', uid), {
    ...out.record,
    name,
    lastGameAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return out;
}

const seasonPct = (x) => (x.w + x.l + x.t ? (x.w + x.t / 2) / (x.w + x.l + x.t) : 0);

/**
 * The record with a finished Season-mode run added: counts it, and keeps it
 * as the best for that team if it beats the old best (win %, then run diff). Pure.
 * @param {object} season { key, team, w, l, t, rf, ra }
 */
export function addSeason(rec, { key, team, w, l, t = 0, rf = 0, ra = 0 }) {
  const r = normalize(JSON.parse(JSON.stringify(rec || {})));
  r.seasonsPlayed = (r.seasonsPlayed || 0) + 1;
  const run = { team, w, l, t, rf, ra, at: new Date().toISOString() };
  const old = r.seasonBests[key];
  const better = !old || seasonPct(run) > seasonPct(old) || (seasonPct(run) === seasonPct(old) && rf - ra > old.rf - old.ra);
  if (better) r.seasonBests[key] = run;
  return r;
}
