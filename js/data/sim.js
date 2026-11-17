// js/data/sim.js
// Aces Sim data: the draft pool for a season (season rosters + that season's
// stats + the admin's saved ratings) and saving those ratings.
//
//   simRatings/{seasonId}
//     { seasonId, players: { [statId]: { range?, arm?, pitch?, contact?, power?, speed? } },
//       updatedAt, updatedBy }
//   Admin-set range/arm/pitch always; contact/power/speed only when the
//   admin overrode the computed value. Everything else is worked out from
//   the stats each time (js/domain/sim-ratings.js), so new games played
//   update the ratings on their own.

import { db, collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from '../core/firebase.js';
import { getDisplaySeasonId, isSeasonId, seasonSortKey } from '../core/config.js';
import { buildPool, buildSofaKings, seasonLine, BOSS } from '../domain/sim-ratings.js';
import { statIdOf } from '../domain/player-id.js';

const seasonOfRosterDoc = (id) => {
  const parts = String(id).split('-');
  return parts.length >= 3 ? `${parts[0]}-${parts[1]}` : '';
};

/** Every roster doc, grouped by season: Map(seasonId -> [{ id, data }]). */
async function rostersBySeason() {
  const snap = await getDocs(collection(db, 'rosters'));
  const out = new Map();
  snap.docs.forEach((d) => {
    const sid = seasonOfRosterDoc(d.id);
    if (!isSeasonId(sid)) return;
    if (!out.has(sid)) out.set(sid, []);
    out.get(sid).push({ id: d.id, data: d.data() });
  });
  return out;
}

/**
 * Seasons that have rosters, newest first, and the one to use by default:
 * the display season if it has rosters, else the newest season that does.
 */
export async function simSeasons(rosters = null) {
  const by = rosters || await rostersBySeason();
  const ids = [...by.keys()].sort((a, b) => seasonSortKey(b) - seasonSortKey(a));
  let preferred = null;
  try { preferred = await getDisplaySeasonId(); } catch { /* none */ }
  const current = preferred && by.has(preferred) ? preferred : ids[0] || null;
  return { ids, current };
}

/**
 * The draft pool for a season.
 * @param {string} [seasonId]  defaults to simSeasons().current
 * @returns {Promise<{ seasonId, seasons: string[], players, league, savedAt }>}
 */
export async function loadSimPool(seasonId) {
  const rosters = await rostersBySeason();
  const { ids, current } = await simSeasons(rosters);
  const sid = seasonId && rosters.has(seasonId) ? seasonId : current;
  if (!sid) return { seasonId: null, seasons: ids, players: [], league: null, savedAt: null };

  const roster = [];
  for (const r of rosters.get(sid)) {
    const teamName = r.data.teamName || r.id.slice(sid.length + 1);
    for (const p of r.data.players || []) {
      if (!p?.name) continue;
      roster.push({ id: p.id || p.playerId || '', name: p.name, team: teamName, position: p.position || '-', bats: p.bats || '' });
    }
  }

  const [statSnap, savedSnap] = await Promise.all([
    getDocs(collection(db, 'aggregatedPlayerStats')),
    getDoc(doc(db, 'simRatings', sid)).catch(() => null)
  ]);
  const statDocs = statSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const saved = savedSnap?.exists() ? savedSnap.data() : {};
  const { players, league } = buildPool({ roster, statDocs, seasonId: sid, saved: saved.players || {} });
  const bats = new Map(roster.map((r) => [r.id, r.bats]));
  players.forEach((p) => { p.bats = normBats(bats.get(p.id)); });

  // The Sofa Kings, from the model player's line (rostered this season or not).
  let model = players.find((p) => p.id === BOSS.model);
  if (!model) {
    const doc = statDocs.find((d) => d.migrated !== true && statIdOf(d) === BOSS.model);
    model = doc ? { line: seasonLine(doc, sid), ratings: saved.players?.[BOSS.model] || {} } : null;
  }
  const boss = buildSofaKings(players, league, model);

  const savedAt = saved.updatedAt?.toDate ? saved.updatedAt.toDate() : null;
  return { seasonId: sid, seasons: ids, players, league, boss, savedAt, savedBy: saved.updatedBy || '' };
}

const normBats = (v) => {
  const s = String(v || '').trim().toUpperCase();
  return s.startsWith('L') ? 'L' : s.startsWith('R') ? 'R' : s.startsWith('S') ? 'S' : '';
};

/** Replace the saved ratings for a season. players: { [id]: { ... } } */
export async function saveSimRatings(seasonId, players, who = '') {
  await setDoc(doc(db, 'simRatings', seasonId), {
    seasonId,
    players,
    updatedAt: serverTimestamp(),
    updatedBy: who
  });
}
