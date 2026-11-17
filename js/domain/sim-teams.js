// js/domain/sim-teams.js
// Backyard Aces Softball, Full teams mode: real teams, this season's or any
// past season's, with no draft. Pure functions (no Firestore).
//
// Teams: this season's and 2026 Summer's come from the season rosters
// (rosters/{seasonId}-{team}); older seasons from the team on each player's
// aggregatedPlayerStats season key ('2024-fall-gold'). A team needs at least
// TEAM_SIZE regular (non-sub) players to show up.
//
// Ratings for a past season, each season rated against its own league (so
// 50 is that year's average):
//   contact, speed   that season's stats
//   power            that season's extra-base hits when the team recorded
//                    them (2026 Fall on; Black, Blue and Teal in 2026 Summer);
//                    otherwise the player's rating this season if he's still
//                    playing, else league average (50)
//   range, arm       his rating this season if still playing, else 50
//   pitch            that season's pitching if he pitched, else his rating
//                    this season, else the usual default
//   position         that season's roster, else this season's, else Utility

import { battingCounts } from './stats.js';
import { parseStatSeasonId, seasonSortKey, hasCompleteHitTypes, HIT_TYPES_TEAMS } from './season-ids.js';
import { statIdOf } from './player-id.js';
import {
  SLOTS, TEAM_SIZE, seasonLine, leagueBaseline, computedRatings, simPosition, bestOverall, overallAt
} from './sim-ratings.js';

const teamOfKey = (key) => String(key).split('-').slice(2).filter((s) => s !== 'sub').join('-').toLowerCase();
const isSubRec = (key, rec) => parseStatSeasonId(key).isSub || /^yes$/i.test(String(rec?.sub || ''));
export const teamKeyOf = (seasonId, team) => `${seasonId}|${String(team).toLowerCase()}`;

/** A player's regular-season team keys: [{ seasonId, team }]. */
function teamsOf(doc) {
  const out = [];
  for (const [k, rec] of Object.entries(doc.seasons || {})) {
    const p = parseStatSeasonId(k);
    if (!p.id || isSubRec(k, rec) || battingCounts(rec).games <= 0) continue;
    const team = teamOfKey(k) || String(rec?.team || '').toLowerCase();
    if (team) out.push({ seasonId: p.id, team });
  }
  return out;
}

/**
 * Every playable team, newest season first.
 * @param {object[]} statDocs  aggregatedPlayerStats docs ({ id, ...data })
 * @param {Object<string, {id,name,team,position,bats}[]>} rosterEntries  seasonId -> roster entries
 * @returns {{ key, seasonId, team, ids: string[] }[]}
 */
export function teamCatalog(statDocs, rosterEntries = {}, { min = TEAM_SIZE } = {}) {
  const by = new Map();
  const add = (seasonId, team, id) => {
    const key = teamKeyOf(seasonId, team);
    if (!by.has(key)) by.set(key, { key, seasonId, team: String(team).toLowerCase(), ids: new Set() });
    by.get(key).ids.add(id);
  };
  const rostered = new Set(Object.keys(rosterEntries));
  for (const d of statDocs) {
    if (!d || d.migrated === true) continue;
    const id = statIdOf(d);
    if (!id) continue;
    for (const t of teamsOf(d)) if (!rostered.has(t.seasonId)) add(t.seasonId, t.team, id);
  }
  for (const [sid, entries] of Object.entries(rosterEntries)) {
    for (const e of entries) {
      const id = statIdOf(e);
      if (id && e.team) add(sid, e.team, id);
    }
  }
  return [...by.values()]
    .filter((t) => t.ids.size >= min)
    .map((t) => ({ ...t, ids: [...t.ids] }))
    .sort((a, b) => seasonSortKey(b.seasonId) - seasonSortKey(a.seasonId) || a.team.localeCompare(b.team));
}

/**
 * A team's players, rated, as pool-player-shaped objects (JSON-safe).
 * @param {object} args
 * @param {{ seasonId, team, ids }} args.entry    from teamCatalog
 * @param {object[]} args.statDocs
 * @param {Object<string, object[]>} args.rosterEntries
 * @param {object[]} args.current        this season's rated pool (sim-ratings buildPool players)
 * @param {string} args.currentSeason
 */
export function buildSeasonTeam({ entry, statDocs, rosterEntries = {}, current = [], currentSeason = '' }) {
  const team = entry.team;
  const curById = new Map(current.map((p) => [p.id, p]));
  const copy = (p) => ({
    id: p.id, name: p.name, team: p.team, position: p.position, pos: p.pos, bats: p.bats || '',
    ratings: { ...p.ratings }, line: p.line, ovr: p.ovr, bestSlot: p.bestSlot
  });

  // This season: the rated pool as it stands (saved ratings and all).
  if (entry.seasonId === currentSeason) {
    return current.filter((p) => String(p.team).toLowerCase() === team).map(copy)
      .sort((a, b) => b.line.g - a.line.g || b.ovr - a.ovr);
  }

  const sid = entry.seasonId;
  const docById = new Map();
  for (const d of statDocs) {
    if (!d || d.migrated === true) continue;
    const id = statIdOf(d);
    if (!id) continue;
    const prev = docById.get(id);
    if (!prev || (!teamsOf(prev).some((t) => t.seasonId === sid) && teamsOf(d).some((t) => t.seasonId === sid))) docById.set(id, d);
  }

  // That season's league, for the 50/10 scale. In a season where only some
  // teams recorded extra-base hits, power is scaled against those teams only.
  const lines = [];
  const powerLines = [];
  const partial = HIT_TYPES_TEAMS[sid] || null;
  for (const d of docById.values()) {
    const l = seasonLine(d, sid);
    if (!(l.ab > 0 || l.ip > 0)) continue;
    lines.push(l);
    if (partial && teamsOf(d).some((t) => t.seasonId === sid && partial.includes(t.team))) powerLines.push(l);
  }
  const league = leagueBaseline(lines, { seasonId: sid });
  const powerLeague = partial && powerLines.length >= 10 ? leagueBaseline(powerLines, { seasonId: sid }) : league;
  const hitTypes = hasCompleteHitTypes(sid, team);
  const rosterOf = new Map((rosterEntries[sid] || []).map((e) => [statIdOf(e), e]));

  const players = [];
  for (const id of entry.ids) {
    const doc = docById.get(id);
    const ros = rosterOf.get(id);
    const cur = curById.get(id);
    const line = seasonLine(doc, sid);
    const pos = simPosition(ros?.position ?? cur?.position ?? '-');
    const comp = computedRatings(line, pos, league);
    const ratings = {
      contact: line.ab > 0 ? comp.contact : (cur?.ratings.contact ?? 50),
      power: hitTypes && line.ab > 0 ? computedRatings(line, pos, powerLeague).power : (cur?.ratings.power ?? 50),
      speed: line.g > 0 ? comp.speed : (cur?.ratings.speed ?? 50),
      range: cur?.ratings.range ?? 50,
      arm: cur?.ratings.arm ?? 50,
      pitch: line.ip > 0 ? comp.pitch : (cur?.ratings.pitch ?? comp.pitch)
    };
    const { ovr, slot } = bestOverall(ratings, pos);
    players.push({
      id,
      name: doc?.name || doc?.displayName || ros?.name || cur?.name || id,
      team: ros?.team || team,
      position: ros?.position ?? cur?.position ?? '-',
      pos,
      bats: ros?.bats || cur?.bats || '',
      ratings,
      line,
      ovr,
      bestSlot: slot,
      stillPlaying: !!cur
    });
  }
  return players.sort((a, b) => b.line.g - a.line.g || b.ovr - a.ovr);
}

/**
 * The best nine from a roster and where they play: each spot (scarcest
 * first) goes to the best player who can play it; if nobody left can, the
 * best player left plays it out of position.
 * @returns {{ nine: string[], field: Object<string, string> }}
 */
export function bestNine(players) {
  const used = new Set();
  const field = {};
  const can = (p, s) => p.pos.slots.includes(s);
  const order = [...SLOTS].sort((a, b) => players.filter((p) => !p.pos.wild && can(p, a)).length
    - players.filter((p) => !p.pos.wild && can(p, b)).length);
  for (const slot of order) {
    const left = players.filter((p) => !used.has(p.id));
    if (!left.length) break;
    const fits = left.filter((p) => can(p, slot));
    const pickFrom = fits.length ? fits : left;
    const best = pickFrom.reduce((a, b) => (overallAt(b.ratings, slot) > overallAt(a.ratings, slot) ? b : a));
    field[slot] = best.id;
    used.add(best.id);
  }
  return { nine: [...used], field };
}
