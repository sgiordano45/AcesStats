// js/domain/pickup.js
// Pick-up games: the power rating and the team balancer. Pure functions with
// no Firestore, so pickup.html and any test can use them the same way.
//
// Power rating, on the acesBPI scale (50 = average, 10 = one standard deviation):
//   career  = acesBPI averaged over a player's regular (non-sub) seasons,
//             weighted by plate appearances. acesBPI is a one-season score,
//             so it is averaged, never added up.
//   current = bWAR per game in the latest season, put on the same 50/10 scale
//             against everyone with RATING.MIN_GAMES that season. bWAR is a
//             running total, so per game keeps a 6-game player comparable
//             with a 20-game one.
//   blend   = career, with RATING.CURRENT_WEIGHT (40%) going to current. That
//             share ramps in over the first RATING.CURRENT_RAMP_GAMES games of
//             the season so a hot first week can't swing it. Only one of the
//             two -> that one.
//   power   = 50 + (blend - 50) * PA / (PA + RATING.SHRINK_PA), so a thin
//             career is pulled toward average. Clamped to 20-80.
// In the offseason the latest season is the one that just ended.
// Players with no stats (guests, new players) get a tier the organizer picks.
//
// Positions are kept in four groups: P, C, IF, OF.

import { battingCounts } from './stats.js';
import { parseStatSeasonId, seasonSortKey } from './season-ids.js';
import { statIdOf } from './player-id.js';

export const RATING = Object.freeze({
  CURRENT_WEIGHT: 0.4,
  CURRENT_RAMP_GAMES: 8,
  SHRINK_PA: 30,
  MIN_GAMES: 3,        // games in the latest season to count toward its bWAR baseline
  MIN: 20,
  MAX: 80
});

/** [value, label] tiers for players with no stats. */
export const TIERS = Object.freeze([
  [40, 'Below average'],
  [45, 'Unknown'],
  [50, 'Average'],
  [55, 'Solid'],
  [60, 'Strong'],
  [70, 'Star']
]);
export const DEFAULT_TIER = 45;

export const POSITIONS = Object.freeze(['P', 'C', 'IF', 'OF']);
export const POSITION_LABELS = Object.freeze({ P: 'Pitcher', C: 'Catcher', IF: 'Infield', OF: 'Outfield' });

/** Player questionnaire positions ('SS', 'OF (any)', 'Anywhere' ...) -> position groups. */
export function positionGroups(list) {
  const out = new Set();
  for (const raw of list || []) {
    const p = String(raw || '').toUpperCase();
    if (p === 'P') out.add('P');
    else if (p === 'C') out.add('C');
    else if (['1B', '2B', '3B', 'SS', 'IF'].includes(p)) out.add('IF');
    else if (p.startsWith('OF') || ['LF', 'CF', 'RF'].includes(p)) out.add('OF');
    else if (p.startsWith('ANY')) POSITIONS.forEach((g) => out.add(g));
  }
  return POSITIONS.filter((g) => out.has(g));
}

const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const clamp = (v) => Math.min(RATING.MAX, Math.max(RATING.MIN, v));
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Power rating
// ---------------------------------------------------------------------------

/**
 * Ratings for every player in aggregatedPlayerStats.
 * @param {object[]} statDocs  aggregatedPlayerStats docs ({ id, name, seasons, ... })
 * @returns {{ byId: Map<string, object>, latest: string }}
 *   byId: stats ID -> { id, name, power, career, current, games, pa }
 *   latest: the season the current part reads ('2026-fall'), or ''
 */
export function buildRatings(statDocs) {
  const people = new Map();   // stats ID -> { name, rows: [] }
  for (const p of statDocs || []) {
    if (!p || p.migrated === true || !p.seasons || typeof p.seasons !== 'object') continue;
    const id = statIdOf(p);
    if (!id) continue;
    const person = people.get(id) || { name: p.name || p.displayName || p.playerName || '', rows: [] };
    for (const [key, s] of Object.entries(p.seasons)) {
      const sid = parseStatSeasonId(key);
      if (!sid.id || !s || typeof s !== 'object') continue;
      const c = battingCounts(s);
      person.rows.push({
        season: sid.id,
        sub: sid.isSub || /^yes$/i.test(String(s.sub || '')),
        pa: c.atBats + c.walks,
        games: c.games,
        bpi: numOrNull(s.acesBPI),
        bwar: numOrNull(s.bwar ?? s.bwarSimp)
      });
    }
    people.set(id, person);
  }

  let latest = '';
  for (const { rows } of people.values()) {
    for (const r of rows) if (!r.sub && seasonSortKey(r.season) > seasonSortKey(latest)) latest = r.season;
  }

  // This season's bWAR per game, for everyone, and its baseline.
  const currentOf = new Map();
  for (const [id, { rows }] of people) {
    const mine = rows.filter((r) => !r.sub && r.season === latest);
    const games = mine.reduce((s, r) => s + r.games, 0);
    const withWar = mine.filter((r) => r.bwar !== null);
    if (!games || !withWar.length) continue;
    currentOf.set(id, { games, perGame: withWar.reduce((s, r) => s + r.bwar, 0) / games });
  }
  const pool = [...currentOf.values()].filter((c) => c.games >= RATING.MIN_GAMES).map((c) => c.perGame);
  const mean = pool.length ? pool.reduce((s, v) => s + v, 0) / pool.length : 0;
  const sd = pool.length > 1 ? Math.sqrt(pool.reduce((s, v) => s + (v - mean) ** 2, 0) / pool.length) : 0;
  const baselineOk = pool.length >= 5 && sd > 0;

  const byId = new Map();
  for (const [id, { name, rows }] of people) {
    const regular = rows.filter((r) => !r.sub);
    const bpiRows = regular.filter((r) => r.bpi !== null && r.pa > 0);
    const bpiPA = bpiRows.reduce((s, r) => s + r.pa, 0);
    const career = bpiPA > 0 ? bpiRows.reduce((s, r) => s + r.bpi * r.pa, 0) / bpiPA : null;

    const cur = currentOf.get(id);
    const current = cur && baselineOk ? 50 + (10 * (cur.perGame - mean)) / sd : null;

    let blend = null;
    if (career !== null && current !== null) {
      const w = RATING.CURRENT_WEIGHT * Math.min(1, cur.games / RATING.CURRENT_RAMP_GAMES);
      blend = (1 - w) * career + w * current;
    } else {
      blend = career ?? current;
    }

    const pa = regular.reduce((s, r) => s + r.pa, 0);
    const power = blend === null ? null : clamp(50 + ((blend - 50) * pa) / (pa + RATING.SHRINK_PA));
    byId.set(id, {
      id,
      name,
      power: power === null ? null : round1(power),
      career: career === null ? null : round1(career),
      current: current === null ? null : round1(current),
      games: cur?.games || 0,
      pa
    });
  }
  return { byId, latest };
}

// ---------------------------------------------------------------------------
// Team balancer
// ---------------------------------------------------------------------------

const PEN = Object.freeze({
  SIZE: 100,        // per player of size gap beyond what an odd count forces
  APART: 1000,      // a keep-apart pair on the same side
  BATTERY: 15,      // a side with no pitcher (or catcher) when there are 2+
  FIELD: 4          // per infielder / outfielder short of a fair share
});

function unionFind(keys) {
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
  return { find, union: (a, b) => parent.set(find(a), find(b)) };
}

/**
 * Units of players that move together ("keep together" pairs joined up).
 * A unit is locked to a side when any member is.
 */
function buildUnits(players, { locks = {}, together = [] } = {}) {
  const keys = players.map((p) => p.key);
  const have = new Set(keys);
  const uf = unionFind(keys);
  together.forEach(([a, b]) => { if (have.has(a) && have.has(b)) uf.union(a, b); });
  const groups = new Map();
  for (const p of players) {
    const root = uf.find(p.key);
    if (!groups.has(root)) groups.set(root, { keys: [], rating: 0, pos: { P: 0, C: 0, IF: 0, OF: 0 }, lock: null });
    const u = groups.get(root);
    u.keys.push(p.key);
    u.rating += p.rating;
    (p.pos || []).forEach((g) => { if (g in u.pos) u.pos[g] += 1; });
    if (!u.lock && (locks[p.key] === 'a' || locks[p.key] === 'b')) u.lock = locks[p.key];
  }
  return [...groups.values()];
}

/** Totals for one side: { count, total, avg, pos: { P, C, IF, OF } }. */
export function sideStats(keys, playerOf) {
  const out = { count: 0, total: 0, avg: 0, pos: { P: 0, C: 0, IF: 0, OF: 0 } };
  for (const k of keys) {
    const p = playerOf(k);
    if (!p) continue;
    out.count += 1;
    out.total += p.rating;
    (p.pos || []).forEach((g) => { if (g in out.pos) out.pos[g] += 1; });
  }
  out.avg = out.count ? out.total / out.count : 0;
  return out;
}

/**
 * What's off about a split, for the balance meter.
 * @returns {{ diff: number, avgDiff: number, issues: string[] }}
 */
export function splitReport(a, b, playerOf, { apart = [] } = {}) {
  const A = sideStats(a, playerOf);
  const B = sideStats(b, playerOf);
  const issues = [];
  const n = A.count + B.count;
  if (Math.abs(A.count - B.count) > n % 2) issues.push(`Teams are ${A.count} vs ${B.count}`);
  for (const g of ['P', 'C']) {
    const t = A.pos[g] + B.pos[g];
    if (t >= 2 && (!A.pos[g] || !B.pos[g])) issues.push(`One side has no ${POSITION_LABELS[g].toLowerCase()}`);
    if (t === 1) issues.push(`Only one ${POSITION_LABELS[g].toLowerCase()} in the group`);
  }
  const inA = new Set(a);
  const inB = new Set(b);
  apart.forEach(([x, y]) => {
    if ((inA.has(x) && inA.has(y)) || (inB.has(x) && inB.has(y))) issues.push(`A keep-apart pair is on the same side`);
  });
  return { a: A, b: B, diff: A.total - B.total, avgDiff: A.avg - B.avg, issues };
}

function costOf(side, units, apartPairs, unitOfKey, totals) {
  let nA = 0, nB = 0, sA = 0, sB = 0;
  const pA = { P: 0, C: 0, IF: 0, OF: 0 };
  const pB = { P: 0, C: 0, IF: 0, OF: 0 };
  units.forEach((u, i) => {
    const onA = side[i] === 'a';
    if (onA) { nA += u.keys.length; sA += u.rating; } else { nB += u.keys.length; sB += u.rating; }
    const p = onA ? pA : pB;
    for (const g in u.pos) p[g] += u.pos[g];
  });
  let cost = Math.abs(sA - sB);
  cost += PEN.SIZE * Math.max(0, Math.abs(nA - nB) - ((nA + nB) % 2));
  for (const g of ['P', 'C']) {
    if (totals[g] >= 2) cost += PEN.BATTERY * ((pA[g] ? 0 : 1) + (pB[g] ? 0 : 1));
  }
  for (const [g, cap] of [['IF', 4], ['OF', 3]]) {
    const want = Math.min(cap, Math.floor(totals[g] / 2));
    cost += PEN.FIELD * (Math.max(0, want - pA[g]) + Math.max(0, want - pB[g]));
  }
  for (const [x, y] of apartPairs) {
    const ux = unitOfKey.get(x);
    const uy = unitOfKey.get(y);
    if (ux === undefined || uy === undefined) continue;
    if (ux === uy || side[ux] === side[uy]) cost += PEN.APART;
  }
  return cost;
}

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Balanced splits, best first.
 * @param {{ key: string, rating: number, pos?: string[] }[]} players
 * @param {object} [opts]
 * @param {Object<string, 'a'|'b'>} [opts.locks]  players pinned to a side
 * @param {[string, string][]} [opts.together]     pairs kept on the same side
 * @param {[string, string][]} [opts.apart]        pairs kept on opposite sides
 * @param {number} [opts.restarts=60]
 * @param {number} [opts.keep=12]                  how many distinct splits to return
 * @param {() => number} [opts.random=Math.random]
 * @returns {{ a: string[], b: string[], cost: number }[]}
 */
export function balanceOptions(players, opts = {}) {
  const { apart = [], restarts = 60, keep = 12, random = Math.random } = opts;
  const list = (players || []).filter((p) => p && p.key);
  if (!list.length) return [{ a: [], b: [], cost: 0 }];
  const units = buildUnits(list, opts);
  const unitOfKey = new Map();
  units.forEach((u, i) => u.keys.forEach((k) => unitOfKey.set(k, i)));
  const totals = { P: 0, C: 0, IF: 0, OF: 0 };
  units.forEach((u) => { for (const g in u.pos) totals[g] += u.pos[g]; });
  const cost = (side) => costOf(side, units, apart, unitOfKey, totals);
  const free = units.map((u, i) => (u.lock ? -1 : i)).filter((i) => i >= 0);

  const seen = new Map();
  for (let r = 0; r < restarts; r += 1) {
    // Start: locked units where they're pinned, the rest best-first (with a
    // little noise) onto whichever side is lighter.
    const side = units.map((u) => u.lock || null);
    let sA = 0, sB = 0, nA = 0, nB = 0;
    units.forEach((u, i) => {
      if (side[i] === 'a') { sA += u.rating; nA += u.keys.length; }
      if (side[i] === 'b') { sB += u.rating; nB += u.keys.length; }
    });
    const order = shuffle(free, random).sort((x, y) => (units[y].rating + random() * 8) - (units[x].rating + random() * 8));
    for (const i of order) {
      const u = units[i];
      const toA = nA !== nB ? nA < nB : sA <= sB;
      side[i] = toA ? 'a' : 'b';
      if (toA) { sA += u.rating; nA += u.keys.length; } else { sB += u.rating; nB += u.keys.length; }
    }

    // Improve: single moves and swaps until nothing helps.
    let best = cost(side);
    for (let pass = 0; pass < 50; pass += 1) {
      let improved = false;
      for (const i of free) {
        side[i] = side[i] === 'a' ? 'b' : 'a';
        const c = cost(side);
        if (c < best - 1e-9) { best = c; improved = true; } else side[i] = side[i] === 'a' ? 'b' : 'a';
      }
      for (const i of free) {
        for (const j of free) {
          if (j <= i || side[i] === side[j]) continue;
          [side[i], side[j]] = [side[j], side[i]];
          const c = cost(side);
          if (c < best - 1e-9) { best = c; improved = true; } else [side[i], side[j]] = [side[j], side[i]];
        }
      }
      if (!improved) break;
    }

    const a = [];
    const b = [];
    units.forEach((u, i) => (side[i] === 'a' ? a : b).push(...u.keys));
    const sig = [...a].sort().join('|');
    if (!seen.has(sig)) seen.set(sig, { a, b, cost: best });
  }
  return [...seen.values()].sort((x, y) => x.cost - y.cost).slice(0, keep);
}
