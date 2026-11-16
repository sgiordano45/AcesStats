// js/domain/sim-ratings.js
// Aces Sim: player ratings and draft positions. Pure functions, no Firestore,
// so sim.html, admin/sim-ratings.html and a node test all use the same math.
//
// Ratings are on the 20-80 scouting scale: 50 = league average, 10 = one
// standard deviation, clamped to 20-80.
//
//   contact  batting average (H / AB)
//   power    extra-base hits per at-bat ((2B + 3B + HR) / AB)
//   speed    runs per game played (R / G), a rough stand-in
//   range    admin-set (defense: how much ground a fielder covers)
//   arm      admin-set (defense: throws, holding runners)
//   pitch    admin-set, preloaded from ERA
//
// Each stat is credibility-weighted toward the league rate before it is
// scaled, so a 6-for-8 week can't come out as an 80:
//   est = Z * player rate + (1 - Z) * league rate,   Z = n / (n + k)
// with n = AB, AB, games or innings and k from SHRINK. The 50/10 scale is then
// set by the mean and spread of those estimates across the season's regulars,
// and the engine turns a rating back into a rate with the same numbers
// (rateFor), so an all-50 lineup plays to the league average.
//
// Positions come from the season roster (rosters/{seasonId}-{team}.players[].position):
//   P, C, 1B, 2B, 3B, SS, LF, CF, RF   that spot only
//   IF                                  any of 1B, 2B, 3B, SS
//   OF                                  any of LF, CF, RF
//   IF/OF                               any infield or outfield spot
//   UT, DH, '-' or blank                Utility: any spot, one per team
//   Flex                                Flex: any spot, one per team

import { battingCounts } from './stats.js';
import { parseStatSeasonId, inningsValue, seasonHasHitTypes } from './season-ids.js';
import { statIdOf } from './player-id.js';

export const SLOTS = Object.freeze(['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);
export const IF_SLOTS = Object.freeze(['1B', '2B', '3B', 'SS']);
export const OF_SLOTS = Object.freeze(['LF', 'CF', 'RF']);
export const SLOT_LABELS = Object.freeze({
  P: 'Pitcher', C: 'Catcher', '1B': 'First base', '2B': 'Second base', '3B': 'Third base',
  SS: 'Shortstop', LF: 'Left field', CF: 'Center field', RF: 'Right field'
});
export const TEAM_SIZE = SLOTS.length;
export const WILD = Object.freeze({ UT: 'UT', FLEX: 'FLEX' });
export const WILD_LABELS = Object.freeze({ UT: 'Utility', FLEX: 'Flex' });

export const RATING_KEYS = Object.freeze(['contact', 'power', 'speed', 'range', 'arm', 'pitch']);
export const STAT_KEYS = Object.freeze(['contact', 'power', 'speed']);   // computed, can be overridden
export const SET_KEYS = Object.freeze(['range', 'arm', 'pitch']);        // admin-set
export const RATING_LABELS = Object.freeze({
  contact: 'Contact', power: 'Power', speed: 'Speed', range: 'Range', arm: 'Arm', pitch: 'Pitching'
});
export const RATING_ABBR = Object.freeze({ contact: 'CON', power: 'POW', speed: 'SPD', range: 'RNG', arm: 'ARM', pitch: 'PIT' });

export const SCALE = Object.freeze({ MIN: 20, MAX: 80, AVG: 50, SD: 10 });
export const SHRINK = Object.freeze({ AB: 20, XBH_AB: 40, GAMES: 4, IP: 14 });
export const QUALIFY = Object.freeze({ AB: 10, GAMES: 3, IP: 7 });   // who sets the 50/10 scale
export const DEFAULTS = Object.freeze({
  noStats: 45,        // contact/power/speed for a player with no at-bats
  defense: 50,        // range and arm until set
  pitcherNoStats: 45, // a rostered P with no pitching line
  nonPitcher: 35      // Utility/Flex who has never pitched
});

// League fallbacks when a season has too little data (or no hit types).
const FALLBACK = Object.freeze({
  ba: 0.5, xbh: 0.12, rg: 0.9, era: 9, bb: 0.07, k: 0.02,
  mix: { d: 0.62, t: 0.13, hr: 0.25 }
});

const clampRating = (v) => Math.min(SCALE.MAX, Math.max(SCALE.MIN, v));
const round = (v) => Math.round(v);
const posKey = (v) => String(v || '').trim().toUpperCase();

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/**
 * Roster position -> where the player can play in the sim.
 * @returns {{ slots: string[], wild: 'UT'|'FLEX'|null, label: string }}
 *   wild players can play any spot but count against the one-per-team limit.
 */
export function simPosition(raw) {
  const s = posKey(raw);
  if (!s || s === '-') return { slots: [...SLOTS], wild: WILD.UT, label: 'UT' };
  const parts = s.split(/[/,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.includes('FLEX')) return { slots: [...SLOTS], wild: WILD.FLEX, label: 'Flex' };
  const set = new Set();
  for (const p of parts) {
    if (SLOTS.includes(p)) set.add(p);
    else if (p === 'IF' || p === 'INF') IF_SLOTS.forEach((x) => set.add(x));
    else if (p === 'OF') OF_SLOTS.forEach((x) => set.add(x));
    else if (p === 'LCF') ['LF', 'CF'].forEach((x) => set.add(x));
    else if (p === 'RCF') ['CF', 'RF'].forEach((x) => set.add(x));
    else if (p === 'ROVER' || p === 'R') OF_SLOTS.forEach((x) => set.add(x));
  }
  if (!set.size) return { slots: [...SLOTS], wild: WILD.UT, label: 'UT' };
  return { slots: SLOTS.filter((x) => set.has(x)), wild: null, label: parts.join('/') };
}

/** Short tag for a position, for chips: 'SS', 'IF', 'IF/OF', 'UT', 'Flex'. */
export function positionTag(pos) {
  if (pos.wild) return pos.wild === WILD.FLEX ? 'Flex' : 'UT';
  const has = (list) => list.every((x) => pos.slots.includes(x));
  if (has(IF_SLOTS) && has(OF_SLOTS) && pos.slots.length === 7) return 'IF/OF';
  if (pos.slots.length === 4 && has(IF_SLOTS)) return 'IF';
  if (pos.slots.length === 3 && has(OF_SLOTS)) return 'OF';
  return pos.slots.join('/');
}

export const canPlay = (pos, slot) => pos.slots.includes(slot);

// ---------------------------------------------------------------------------
// Season lines from aggregatedPlayerStats
// ---------------------------------------------------------------------------

/** A player's regular (non-sub) batting and pitching totals for one season. */
export function seasonLine(statDoc, seasonId) {
  const out = { g: 0, ab: 0, h: 0, bb: 0, r: 0, so: 0, d: 0, t: 0, hr: 0, ip: 0, ra: 0, pg: 0 };
  if (!statDoc) return out;
  for (const [key, rec] of Object.entries(statDoc.seasons || {})) {
    const sid = parseStatSeasonId(key);
    if (sid.id !== seasonId || sid.isSub || /^yes$/i.test(String(rec?.sub || ''))) continue;
    const c = battingCounts(rec);
    out.g += c.games; out.ab += c.atBats; out.h += c.hits; out.bb += c.walks; out.r += c.runs;
    out.so += c.strikeouts; out.d += c.doubles; out.t += c.triples; out.hr += c.homeRuns;
  }
  for (const [key, rec] of Object.entries(statDoc.pitchingSeasons || {})) {
    const sid = parseStatSeasonId(key);
    if (sid.id !== seasonId || sid.isSub || !rec) continue;
    out.ip += inningsValue(rec.inningsPitched ?? rec.IP);
    out.ra += Number(rec.runsAllowed ?? rec.runs_allowed ?? rec['runs allowed'] ?? 0) || 0;
    out.pg += Number(rec.games ?? rec.G ?? 0) || 0;
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const sdOf = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
};

/**
 * League rates and the spread each rating is scaled with.
 * @param {object[]} lines  seasonLine() for every player with stats that season
 * @returns {object} league: rates (ba, xbh, rg, era, bb, k), their scale
 *   (mean/sd of the shrunk estimates among qualifiers), the hit-type mix and
 *   how sure we are (hitTypes: false when the season has no 2B/3B/HR).
 */
export function leagueBaseline(lines, { seasonId = '' } = {}) {
  const sum = (k) => lines.reduce((s, l) => s + (l[k] || 0), 0);
  const AB = sum('ab'), H = sum('h'), BB = sum('bb'), SO = sum('so'), R = sum('r'), G = sum('g');
  const D = sum('d'), T = sum('t'), HR = sum('hr'), IP = sum('ip'), RA = sum('ra');
  const XBH = D + T + HR;
  const hitTypes = (seasonId ? seasonHasHitTypes(seasonId) : true) && XBH > 0;

  const ba = AB > 50 ? H / AB : FALLBACK.ba;
  const xbh = hitTypes && AB > 50 ? XBH / AB : FALLBACK.xbh;
  const rg = G > 20 ? R / G : FALLBACK.rg;
  const era = IP > 10 ? (RA * 7) / IP : FALLBACK.era;
  const bb = AB + BB > 50 ? BB / (AB + BB) : FALLBACK.bb;
  const k = AB + BB > 50 && SO > 0 ? SO / (AB + BB) : FALLBACK.k;
  const mix = hitTypes ? { d: D / XBH, t: T / XBH, hr: HR / XBH } : { ...FALLBACK.mix };

  const est = {
    contact: (l) => (l.h + SHRINK.AB * ba) / (l.ab + SHRINK.AB),
    power: (l) => (l.d + l.t + l.hr + SHRINK.XBH_AB * xbh) / (l.ab + SHRINK.XBH_AB),
    speed: (l) => (l.r + SHRINK.GAMES * rg) / (l.g + SHRINK.GAMES),
    pitch: (l) => (l.ra * 7 + SHRINK.IP * era) / (l.ip + SHRINK.IP)
  };
  const scaleFrom = (key, qualified, fallbackSd) => {
    const vals = qualified.map(est[key]);
    const sd = sdOf(vals);
    return { mean: vals.length >= 5 ? mean(vals) : null, sd: vals.length >= 5 && sd > 0 ? sd : fallbackSd };
  };
  const batters = lines.filter((l) => l.ab >= QUALIFY.AB);
  const runners = lines.filter((l) => l.g >= QUALIFY.GAMES);
  const pitchers = lines.filter((l) => l.ip >= QUALIFY.IP);
  const scale = {
    contact: scaleFrom('contact', batters, 0.05),
    power: scaleFrom('power', batters, 0.03),
    speed: scaleFrom('speed', runners, 0.25),
    pitch: scaleFrom('pitch', pitchers, 2)
  };
  // Centre on the league rate when there aren't enough qualifiers to say otherwise.
  scale.contact.mean ??= ba;
  scale.power.mean ??= xbh;
  scale.speed.mean ??= rg;
  scale.pitch.mean ??= era;

  return {
    seasonId, ba, xbh, rg, era, bb, k, mix, hitTypes,
    scale, est,
    totals: { ab: AB, h: H, bb: BB, so: SO, r: R, g: G, xbh: XBH, ip: IP, ra: RA },
    // Runs per team per 7 innings, for the "does the sim look right" check.
    runsPerGame: IP > 10 ? (RA * 7) / IP : null
  };
}

/** Rating for one estimate on the 20-80 scale (pitching: lower ERA is better). */
function toRating(key, value, league) {
  const { mean: m, sd } = league.scale[key];
  const z = (value - m) / sd;
  return round(clampRating(SCALE.AVG + SCALE.SD * (key === 'pitch' ? -z : z)));
}

/**
 * A rating back to the rate the engine plays with: contact -> AVG,
 * power -> XBH per AB, speed -> R/G, pitch -> ERA. Same scale as toRating.
 */
export function rateFor(key, rating, league) {
  const { mean: m, sd } = league.scale[key];
  const z = (Number(rating) - SCALE.AVG) / SCALE.SD;
  return m + (key === 'pitch' ? -z : z) * sd;
}

/** Ratings computed from the stats (no admin edits), plus sample sizes. */
export function computedRatings(line, pos, league) {
  const hasBat = line.ab > 0;
  const out = {
    contact: hasBat ? toRating('contact', league.est.contact(line), league) : DEFAULTS.noStats,
    power: hasBat ? toRating('power', league.est.power(line), league) : DEFAULTS.noStats,
    speed: line.g > 0 ? toRating('speed', league.est.speed(line), league) : DEFAULTS.noStats,
    range: DEFAULTS.defense,
    arm: DEFAULTS.defense,
    pitch: line.ip > 0
      ? toRating('pitch', league.est.pitch(line), league)
      : (pos.slots.includes('P') && !pos.wild ? DEFAULTS.pitcherNoStats : DEFAULTS.nonPitcher)
  };
  return out;
}

// ---------------------------------------------------------------------------
// Overall (draft value)
// ---------------------------------------------------------------------------

// How much range vs arm matters at each spot, and how much defense matters there.
export const DEF_WEIGHTS = Object.freeze({
  C: { range: 0.3, arm: 0.7, weight: 0.15 },
  '1B': { range: 0.7, arm: 0.3, weight: 0.2 },
  '2B': { range: 0.65, arm: 0.35, weight: 0.3 },
  SS: { range: 0.6, arm: 0.4, weight: 0.35 },
  '3B': { range: 0.45, arm: 0.55, weight: 0.3 },
  LF: { range: 0.55, arm: 0.45, weight: 0.3 },
  CF: { range: 0.7, arm: 0.3, weight: 0.35 },
  RF: { range: 0.5, arm: 0.5, weight: 0.3 }
});

export const batValue = (r) => 0.5 * r.contact + 0.3 * r.power + 0.2 * r.speed;

export function defValue(r, slot) {
  const w = DEF_WEIGHTS[slot];
  return w ? w.range * r.range + w.arm * r.arm : r.pitch;
}

/** Overall at one spot: hitting plus that spot's defense (pitching for P). */
export function overallAt(r, slot) {
  if (slot === 'P') return 0.55 * batValue(r) + 0.45 * r.pitch;
  const w = DEF_WEIGHTS[slot].weight;
  return (1 - w) * batValue(r) + w * defValue(r, slot);
}

/** Best overall across the spots the player can play: { ovr, slot }. */
export function bestOverall(r, pos) {
  let best = { ovr: -Infinity, slot: pos.slots[0] };
  for (const slot of pos.slots) {
    const o = overallAt(r, slot);
    if (o > best.ovr) best = { ovr: o, slot };
  }
  return { ovr: Math.round(best.ovr), slot: best.slot };
}

// ---------------------------------------------------------------------------
// The draft pool
// ---------------------------------------------------------------------------

const validRating = (v) => Number.isFinite(Number(v)) && Number(v) >= SCALE.MIN && Number(v) <= SCALE.MAX;

/**
 * Everyone on a season's rosters, with stats, computed ratings and the
 * admin's saved values applied.
 *
 * @param {object} args
 * @param {{ id, name, team, position }[]} args.roster  season roster entries (team = team name)
 * @param {object[]} args.statDocs  aggregatedPlayerStats docs as { id, ...data }
 * @param {string} args.seasonId
 * @param {object} [args.saved]     simRatings/{seasonId}.players: { [id]: { contact?, power?, speed?, range?, arm?, pitch? } }
 * @returns {{ players: object[], league: object }}
 *   player: { id, name, team, position, pos, line, computed, ratings, edited: Set<string>, ovr, bestSlot }
 */
export function buildPool({ roster = [], statDocs = [], seasonId, saved = {} }) {
  const byStatId = new Map();
  for (const d of statDocs) {
    if (!d || d.migrated === true) continue;
    const id = statIdOf(d);
    if (!id) continue;
    const prev = byStatId.get(id);
    // Two docs for one player (account + legacy): keep the one with this season.
    if (!prev || (!hasSeason(prev, seasonId) && hasSeason(d, seasonId))) byStatId.set(id, d);
  }

  const lines = [];
  for (const d of byStatId.values()) {
    const l = seasonLine(d, seasonId);
    if (l.ab > 0 || l.ip > 0) lines.push(l);
  }
  const league = leagueBaseline(lines, { seasonId });

  const seen = new Set();
  const players = [];
  for (const entry of roster) {
    const id = statIdOf(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pos = simPosition(entry.position);
    const line = seasonLine(byStatId.get(id), seasonId);
    const computed = computedRatings(line, pos, league);
    const mine = saved?.[id] || {};
    const ratings = { ...computed };
    const edited = new Set();
    for (const k of RATING_KEYS) {
      if (validRating(mine[k])) {
        ratings[k] = Math.round(Number(mine[k]));
        if (ratings[k] !== computed[k] || SET_KEYS.includes(k)) edited.add(k);
      }
    }
    const { ovr, slot } = bestOverall(ratings, pos);
    players.push({
      id, name: entry.name || id, team: entry.team || '', position: entry.position || '-',
      pos, line, computed, ratings, edited, ovr, bestSlot: slot
    });
  }
  players.sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return { players, league };
}

function hasSeason(doc, seasonId) {
  return Object.keys(doc?.seasons || {}).some((k) => parseStatSeasonId(k).id === seasonId);
}

/** Recompute ovr/bestSlot after ratings change. */
export function refreshOverall(p) {
  const { ovr, slot } = bestOverall(p.ratings, p.pos);
  p.ovr = ovr;
  p.bestSlot = slot;
  return p;
}

/**
 * What to save for one player: admin-set values always, stat ratings only
 * when they differ from the computed ones. Returns null when nothing to save.
 */
export function savedEntry(p) {
  const out = {};
  for (const k of SET_KEYS) if (p.edited.has(k)) out[k] = p.ratings[k];
  for (const k of STAT_KEYS) if (p.ratings[k] !== p.computed[k]) out[k] = p.ratings[k];
  return Object.keys(out).length ? out : null;
}

/** A league object safe to store or post: no functions. */
export function leagueSummary(league) {
  const { est, ...rest } = league;
  return JSON.parse(JSON.stringify(rest));
}

/** Rebuild est() helpers for a league read back from JSON (localStorage). */
export function reviveLeague(plain) {
  const l = { ...plain };
  const { ba, xbh, rg, era } = l;
  l.est = {
    contact: (x) => (x.h + SHRINK.AB * ba) / (x.ab + SHRINK.AB),
    power: (x) => (x.d + x.t + x.hr + SHRINK.XBH_AB * xbh) / (x.ab + SHRINK.XBH_AB),
    speed: (x) => (x.r + SHRINK.GAMES * rg) / (x.g + SHRINK.GAMES),
    pitch: (x) => (x.ra * 7 + SHRINK.IP * era) / (x.ip + SHRINK.IP)
  };
  return l;
}
