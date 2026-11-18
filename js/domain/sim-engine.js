// js/domain/sim-engine.js
// Aces Sim: the draft rules, the computer drafter, lineups and the at-bat
// engine. Pure functions on plain objects (no DOM, no Firestore), so a game
// can be saved to localStorage as JSON and a node script can sim 1,000 games.
//
// Draft: two teams take turns (snake) until each has 9. A team must be able
// to field all 9 spots (P C 1B 2B 3B SS LF CF RF) from its picks, with at
// most one Utility and one Flex player. A pick is only allowed when both
// teams can still be completed from who is left (draftFeasible).
//
// Game: 7 innings, extras to MAX_INNINGS, the league mercy rule (15 runs
// after 4, 12 after 5). Each plate appearance is planned (planPA: rolls the
// dice, nothing changes yet) and then committed (commitPA). A close play on
// the bases comes back as a decision (send or hold) so the page can ask the
// manager before committing.
//
// Field coordinates are feet: home plate (0,0), y toward center field.
// Two parks: Senior Field (the fall field) and Field of Dreams (the summer
// field); see FIELDS. A game's park is g.park.

import {
  SLOTS, IF_SLOTS, OF_ALL, WILD,
  rateFor, batValue, defValue, DEF_WEIGHTS
} from './sim-ratings.js';

export const INNINGS = 7;
export const MAX_INNINGS = 10;
export const MERCY = Object.freeze([{ after: 5, lead: 12 }, { after: 4, lead: 15 }]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const z = (rating) => ((Number(rating) || 50) - 50) / 10;

// ===========================================================================
// Draft rules
// ===========================================================================

// The draft and lineup helpers take the format's spots (nine in the fall,
// ten in the summer); a player's positions are read within them.
const within = (p, slots) => p.pos.slots.filter((s) => slots.includes(s));
const sigOf = (p, slots) => (p.pos.wild ? `W:${p.pos.wild}` : `S:${within(p, slots).join(',')}`);

function groupBySig(players, slots) {
  const m = new Map();
  for (const p of players) {
    const k = sigOf(p, slots);
    if (!m.has(k)) m.set(k, { sig: k, wild: p.pos.wild, slots: within(p, slots), count: 0 });
    m.get(k).count += 1;
  }
  return [...m.values()];
}

/** Tiny max-flow graph (adjacency lists with residual capacities). */
class Flow {
  constructor() { this.adj = []; this.n = 0; }
  node() { this.adj.push([]); return this.n++; }
  edge(u, v, c) {
    const a = { to: v, cap: c, rev: null };
    const b = { to: u, cap: 0, rev: a };
    a.rev = b;
    this.adj[u].push(a);
    this.adj[v].push(b);
    return a;
  }
  // One augmenting path from s to t whose first edge is in `firsts`; pushes 1 unit.
  augment(s, t, firsts) {
    const prev = new Array(this.n).fill(null);
    const seen = new Array(this.n).fill(false);
    seen[s] = true;
    const queue = [];
    for (const e of firsts) {
      if (e.cap > 0 && !seen[e.to]) { seen[e.to] = true; prev[e.to] = e; queue.push(e.to); }
    }
    while (queue.length) {
      const u = queue.shift();
      if (u === t) break;
      for (const e of this.adj[u]) {
        if (e.cap > 0 && !seen[e.to]) { seen[e.to] = true; prev[e.to] = e; queue.push(e.to); }
      }
    }
    if (!seen[t]) return false;
    for (let v = t; v !== s; v = prev[v].rev.to) { prev[v].cap -= 1; prev[v].rev.cap += 1; }
    return true;
  }
}

/**
 * Can every team still be completed to 9, from its own picks plus the pool?
 * @param {{ picks: object[] }[]} teams
 * @param {object[]} pool  players not yet drafted
 */
export function draftFeasible(teams, pool, { slots = SLOTS } = {}) {
  const size = slots.length;
  for (const t of teams) {
    if (t.picks.length > size) return false;
    for (const w of Object.values(WILD)) if (t.picks.filter((p) => p.pos.wild === w).length > 1) return false;
  }
  const f = new Flow();
  const S = f.node();
  const T = f.node();
  const slotNode = teams.map(() => Object.fromEntries(slots.map((s) => [s, f.node()])));
  const wildNode = teams.map((_, ti) => Object.fromEntries(Object.values(WILD).map((w) => {
    const inN = f.node();
    const outN = f.node();
    f.edge(inN, outN, 1);
    slots.forEach((s) => f.edge(outN, slotNode[ti][s], 1));
    return [w, inN];
  })));
  teams.forEach((_, ti) => slots.forEach((s) => f.edge(slotNode[ti][s], T, 1)));

  const link = (g, teamIdxs) => {
    const gn = f.node();
    const first = f.edge(S, gn, g.count);
    for (const ti of teamIdxs) {
      if (g.wild) f.edge(gn, wildNode[ti][g.wild], g.count);
      else g.slots.forEach((s) => f.edge(gn, slotNode[ti][s], g.count));
    }
    return first;
  };

  // Drafted players first: each must end up in a spot.
  const own = [];
  let ownCount = 0;
  teams.forEach((t, ti) => groupBySig(t.picks, slots).forEach((g) => { own.push(link(g, [ti])); ownCount += g.count; }));
  const all = teams.map((_, i) => i);
  const fromPool = groupBySig(pool, slots).map((g) => link(g, all));

  let flow = 0;
  while (flow < ownCount && f.augment(S, T, own)) flow += 1;
  if (flow < ownCount) return false;
  const need = teams.length * size;
  while (flow < need && f.augment(S, T, [...own, ...fromPool])) flow += 1;
  return flow === need;
}

/**
 * Which pool players `teamIdx` may take now. Validity only depends on a
 * player's position group, so it is worked out once per group.
 * @returns {Set<string>} player ids
 */
export function legalPicks(teamIdx, teams, pool, { slots = SLOTS } = {}) {
  const ok = new Set();
  if (teams[teamIdx].picks.length >= slots.length) return ok;
  const bySig = new Map();
  for (const p of pool) {
    const k = sigOf(p, slots);
    if (!bySig.has(k)) {
      const rest = pool.filter((x) => x !== p);
      const next = teams.map((t, i) => (i === teamIdx ? { picks: [...t.picks, p] } : t));
      bySig.set(k, draftFeasible(next, rest, { slots }));
    }
    if (bySig.get(k)) ok.add(p.id);
  }
  return ok;
}

/** Snake order: which team picks at overall pick n (0-based). */
export function pickOwner(n, firstTeam = 0) {
  const round = Math.floor(n / 2);
  const inRound = n % 2;
  const first = round % 2 === 0 ? firstTeam : 1 - firstTeam;
  return inRound === 0 ? first : 1 - first;
}

// ===========================================================================
// Positions and lineups
// ===========================================================================

/** How good a player is at a spot, for choosing who plays where. */
function fitScore(p, slot) {
  if (slot === 'P') return 1.6 * p.ratings.pitch;
  return (0.6 + DEF_WEIGHTS[slot].weight) * defValue(p.ratings, slot);
}

/**
 * Best assignment of players to distinct spots (all of them placed).
 * Works for a partial team too. Returns { [slot]: playerId } or null.
 */
export function assignPositions(players, slots = SLOTS) {
  const list = [...players].sort((a, b) => within(a, slots).length - within(b, slots).length);
  let best = null;
  let bestScore = -Infinity;
  const used = new Set();
  const cur = {};
  const maxRest = list.map((_, i) => list.slice(i).reduce((sum, p) => sum + Math.max(0, ...within(p, slots).map((sl) => fitScore(p, sl))), 0));
  const walk = (i, score) => {
    if (i === list.length) {
      if (score > bestScore) { bestScore = score; best = { ...cur }; }
      return;
    }
    if (score + maxRest[i] <= bestScore) return;
    const p = list[i];
    const options = within(p, slots).filter((s) => !used.has(s)).sort((a, b) => fitScore(p, b) - fitScore(p, a));
    for (const s of options) {
      used.add(s); cur[s] = p.id;
      walk(i + 1, score + fitScore(p, s));
      used.delete(s); delete cur[s];
    }
  };
  walk(0, 0);
  return best;
}

/** Default batting order: table-setters 1-2, the big bats 3-4, then by bat value. */
export function battingOrder(players) {
  const byBat = [...players].sort((a, b) => batValue(b.ratings) - batValue(a.ratings));
  const top = byBat.slice(0, 4);
  const rest = byBat.slice(4);
  const sluggers = [...top].sort((a, b) => b.ratings.power - a.ratings.power).slice(0, 2);
  const setters = top.filter((p) => !sluggers.includes(p))
    .sort((a, b) => (b.ratings.contact + b.ratings.speed) - (a.ratings.contact + a.ratings.speed));
  return [...setters, ...sluggers, ...rest].map((p) => p.id);
}

// ===========================================================================
// The computer drafter
// ===========================================================================

// Computer personalities. Each one weighs the ratings its own way, then picks
// at random among the players it likes, more loosely the higher its
// temperature (softmax over value): at 4, a player 4 points worse is taken
// about a third as often as the best one.
//   w: multipliers on contact, power, speed, defense (range/arm) and pitching
//   favorite: likes one real team's players (+FAVORITE_BONUS)
export const CPU_STYLES = Object.freeze({
  fundamentals: { name: 'The Fundamentals', blurb: 'Takes the best player at a spot it needs.', w: { contact: 1, power: 1, speed: 1, def: 1, pitch: 1 }, temp: 3.5 },
  sluggers: { name: 'The Long Ball Boys', blurb: 'Power first, second and third.', w: { contact: 0.7, power: 2.4, speed: 0.4, def: 0.6, pitch: 0.8 }, temp: 4.5 },
  moneyball: { name: 'Moneyball', blurb: 'Contact hitters who never make an out.', w: { contact: 2.3, power: 0.6, speed: 0.8, def: 0.8, pitch: 0.9 }, temp: 4 },
  smallball: { name: 'Small Ball', blurb: 'Speed and contact. Runs on everything.', w: { contact: 1.5, power: 0.3, speed: 2.4, def: 0.9, pitch: 0.8 }, temp: 4.5 },
  leather: { name: 'Leather and Arms', blurb: 'Defense and pitching win championships.', w: { contact: 0.8, power: 0.6, speed: 0.7, def: 2.6, pitch: 2 }, temp: 4.5 },
  homer: { name: 'The Homer', blurb: 'Can\u2019t help taking guys from one team.', w: { contact: 1, power: 1, speed: 1, def: 1, pitch: 1 }, temp: 5, favorite: true },
  chaos: { name: 'Chaos Agent', blurb: 'Nobody, including the computer, knows what it\u2019s doing.', w: { contact: 1, power: 1, speed: 1, def: 1, pitch: 1 }, temp: 14 }
});
export const FAVORITE_BONUS = 8;
// The user's Auto-pick: close to the best available.
export const AUTO_PICK = Object.freeze({ w: CPU_STYLES.fundamentals.w, temp: 1.5 });

const dev = (v) => (Number(v) || 50) - 50;
/** Value at a spot through a personality's eyes. All weights 1 = overallAt. */
export function styledAt(r, slot, w) {
  const bat = 0.5 * w.contact * dev(r.contact) + 0.3 * w.power * dev(r.power) + 0.2 * w.speed * dev(r.speed);
  if (slot === 'P') return 50 + 0.55 * bat + 0.45 * w.pitch * dev(r.pitch);
  const dw = DEF_WEIGHTS[slot];
  return 50 + (1 - dw.weight) * bat + dw.weight * w.def * (dw.range * dev(r.range) + dw.arm * dev(r.arm));
}

/**
 * The computer's pick. Values each legal player at the spots its team still
 * needs (as its personality sees them), with a bump for spots few players
 * can fill, then draws one at random weighted toward the best.
 * @param {object} [opts] { random, style: CPU_STYLES key or { w, temp }, favorite: team name }
 */
export function cpuPick(teamIdx, teams, pool, { random = Math.random, style = 'fundamentals', favorite = '', slots = SLOTS } = {}) {
  const st = typeof style === 'string' ? (CPU_STYLES[style] || CPU_STYLES.fundamentals) : style;
  const legal = legalPicks(teamIdx, teams, pool, { slots });
  const mine = teams[teamIdx].picks;
  const placed = assignPositions(mine, slots) || {};
  const open = slots.filter((s) => !placed[s]);
  const remaining = slots.length - mine.length;
  // How many non-wild players left could fill each open spot.
  const supply = Object.fromEntries(open.map((s) => [s, pool.filter((p) => !p.pos.wild && p.pos.slots.includes(s)).length]));
  const fav = String(favorite || '').toLowerCase();

  const scored = [];
  for (const p of pool) {
    if (!legal.has(p.id)) continue;
    const fits = within(p, slots).filter((s) => open.includes(s));
    let val;
    if (fits.length) {
      val = Math.max(...fits.map((s) => styledAt(p.ratings, s, st.w) + (supply[s] <= 3 ? 6 : supply[s] <= 6 ? 2 : 0)));
    } else {
      val = Math.max(...within(p, slots).map((s) => styledAt(p.ratings, s, st.w))) - 6; // would have to move someone
    }
    if (p.pos.wild) val -= remaining > 3 ? 3 : 0; // keep the wildcard for later
    if (fav && String(p.team || '').toLowerCase() === fav) val += FAVORITE_BONUS;
    scored.push({ p, val });
  }
  if (!scored.length) return null;
  const top = Math.max(...scored.map((x) => x.val));
  const temp = Math.max(0.5, st.temp ?? 3.5);
  const weights = scored.map((x) => Math.exp((x.val - top) / temp));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return scored[i].p;
  }
  return scored[scored.length - 1].p;
}

/**
 * Deal a random draft pool of `size` players that both teams can still
 * fill all nine spots from. Returns the dealt players (or all of them when
 * size covers the whole pool).
 */
export function dealPool(players, size, { random = Math.random, teams = 2, slots = SLOTS } = {}) {
  if (!size || size >= players.length) return [...players];
  const shuffled = () => {
    const a = [...players];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const empty = Array.from({ length: teams }, () => ({ picks: [] }));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const order = shuffled();
    const dealt = [];
    const have = new Set();
    // Make sure every spot has a few players who can fill it, scarce spots first.
    const scarce = [...slots].sort((a, b) => players.filter((p) => !p.pos.wild && p.pos.slots.includes(a)).length
      - players.filter((p) => !p.pos.wild && p.pos.slots.includes(b)).length);
    for (const slot of scarce) {
      let n = dealt.filter((p) => !p.pos.wild && p.pos.slots.includes(slot)).length;
      for (const p of order) {
        if (n >= teams + 1) break;
        if (!have.has(p.id) && !p.pos.wild && p.pos.slots.includes(slot)) { dealt.push(p); have.add(p.id); n += 1; }
      }
    }
    for (const p of order) {
      if (dealt.length >= size) break;
      if (!have.has(p.id)) { dealt.push(p); have.add(p.id); }
    }
    if (draftFeasible(empty, dealt, { slots })) return dealt;
  }
  return [...players];
}

// ===========================================================================
// The game
// ===========================================================================

// Senior Field, laid out from aerial photos (turned so straightaway center
// is +y) and scaled to two known distances: 223 ft from home to the next
// diamond's first-base dugout, and 216 ft to the fence in straightaway right.
//   - 65-foot bases.
//   - The fence: one section from just foul down the right-field line
//     (~195 ft) through right (216 ft) to right-center, a gap (~240 ft),
//     then a section through center (~295 ft) that ends in left-center.
//     Left field has no fence and runs into the next diamond.
//   - Ground rules: through the gap is an automatic triple; past the next
//     diamond's first-base dugout (which runs along the left-field line,
//     about 33 ft fair, from 223 ft out) is a ground-rule double.
// spots: where fielders stand, as an angle from straightaway center
// (degrees, left negative) and a distance in feet.
const SENIOR = Object.freeze({
  key: 'senior',
  name: 'Senior Field',
  base: 65,
  mound: 50,
  fence: Object.freeze([
    Object.freeze([{ x: 62.7, y: 231.6 }, { x: 146.4, y: 126.4 }]),   // right field, to the gap
    Object.freeze([{ x: 43.2, y: 240.1 }, { x: -33.6, y: 337.8 }])    // the gap, through center to left-center
  ]),
  gap: Object.freeze([{ x: 62.7, y: 231.6 }, { x: 43.2, y: 240.1 }]),
  // Out of play: the strip left of the next diamond's first-base dugout, and the dugout itself.
  dead: Object.freeze([
    Object.freeze([{ x: -156.2, y: 156.2 }, { x: -133.3, y: 179.2 }]),
    Object.freeze([{ x: -133.3, y: 179.2 }, { x: -161.4, y: 209.3 }])
  ]),
  // The next diamond, for drawing: the corners of its dirt square (about
  // 70 ft a side) at home, 1B, 2B and 3B. Its bases sit inside them.
  other: Object.freeze([{ x: -158.5, y: 222.1 }, { x: -95.9, y: 192.4 }, { x: -66.9, y: 258.6 }, { x: -133.6, y: 283.2 }]),
  // Scenery beyond the infield is placed in the photos' units times this.
  photoScale: 1.12,
  spots: {
    P: { a: 0, r: 50 }, C: { a: 0, r: -7 },
    '1B': { a: 38, r: 80 }, '2B': { a: 14, r: 108 }, SS: { a: -14, r: 108 }, '3B': { a: -38, r: 80 },
    LF: { a: -26, r: 196 }, LCF: { a: -12, r: 212 }, CF: { a: 2, r: 218 }, RCF: { a: 12, r: 205 }, RF: { a: 25, r: 172 }
  },
  overShare: 0.09,          // 2026 Fall: 6 of 70 home runs cleared the fence
  tripleShare: 0.35,        // triples that are the automatic triple through the gap
  tripleText: 'rolls one through the gap in the center-field fence: an automatic triple',
  tripleBanner: 'AUTOMATIC TRIPLE',
  deadOdds: 1,              // every double that gets past the dugout is a ground-rule double
  deadText: 'rolling past the dugout down the left-field line'
});

// Field of Dreams (the summer field): fenced all the way around. 280 ft
// down the left-field line (a tall double-height fence, trees and the road
// behind), 315 ft to dead center, 235 ft down the right-field line (a lower
// fence; the tennis courts beyond the right-field line are foul).
//   - Over any fence is a home run.
//   - The last 6 ft of fence in the right-field corner is open: through it
//     is a ground-rule double.
//   - A small hole in the fence in dead center: through it is a ground-rule triple.
//   - A big tree branch lies in right-center near the fence: a ball that
//     rolls into it is dead, a ground-rule double.
//   - The light poles are outside the fence.
const DREAMS = Object.freeze({
  key: 'dreams',
  name: 'Field of Dreams',
  base: 65,
  mound: 50,
  fence: Object.freeze([
    Object.freeze([{ x: -198.0, y: 198.0 }, { x: -114.8, y: 277.2 }]),    // left-field pole to left-center
    Object.freeze([{ x: -114.8, y: 277.2 }, { x: -1.5, y: 315.0 }]),     // to the hole in dead center
    Object.freeze([{ x: 1.5, y: 315.0 }, { x: 102.6, y: 247.6 }]),       // from the hole to right-center
    Object.freeze([{ x: 102.6, y: 247.6 }, { x: 162.5, y: 170.9 }])      // to the opening in the right-field corner
  ]),
  poles: Object.freeze([{ x: -198.0, y: 198.0 }, { x: 166.2, y: 166.2 }]),
  // The hole in dead center (a ground-rule triple), playing the part of Senior Field's gap.
  gap: Object.freeze([{ x: -1.5, y: 315.0 }, { x: 1.5, y: 315.0 }]),
  // The opening in the right-field corner, the last 6 ft before the pole (a ground-rule double).
  corner: Object.freeze([{ x: 162.5, y: 170.9 }, { x: 166.2, y: 166.2 }]),
  // The tree branch in right-center: a ball that rolls into it is dead.
  dead: Object.freeze([Object.freeze([{ x: 67.8, y: 253.1 }, { x: 86.5, y: 244.1 }])]),
  spots: {
    P: { a: 0, r: 50 }, C: { a: 0, r: -7 },
    '1B': { a: 38, r: 80 }, '2B': { a: 14, r: 108 }, SS: { a: -14, r: 108 }, '3B': { a: -38, r: 80 },
    LF: { a: -28, r: 205 }, LCF: { a: -10, r: 232 }, CF: { a: 0, r: 235 }, RCF: { a: 11, r: 222 }, RF: { a: 29, r: 178 }
  },
  overShare: 0.4,           // short fences all around: most home runs leave the park
  tripleShare: 0.08,        // triples (and a few doubles) that squeeze through the hole in center
  holeDoubles: 0.01,
  tripleText: 'squeezes one through the hole in the center-field fence: a ground-rule triple',
  tripleBanner: 'GROUND-RULE TRIPLE',
  deadOdds: 0.28,           // gappers to right-center that roll all the way into the branch
  deadText: 'rolling into the tree branch in right-center: dead ball',
  cornerOdds: 0.3,          // doubles down the right-field line that find the opening
  cornerText: 'rolling through the opening in the right-field corner'
});

export const FIELDS = Object.freeze({ senior: SENIOR, dreams: DREAMS });
export const FIELD = SENIOR;   // the default park
/** The park a game is played at. */
export const parkOf = (g) => FIELDS[g?.park] || SENIOR;

// Share of home runs that clear the fence at Senior Field; the rest are
// inside-the-parkers. 2026 Fall: 6 of 70 home runs were flagged out of the park.
export const OVER_FENCE_SHARE = SENIOR.overShare;

// Weather and field conditions, one per game. Multipliers on the batter's
// hit rate (ba) and extra-base-hit rate (xbh), the share of home runs that
// clear the fence (over), errors (err), the gap-triple share (gap), and an
// add-on to the odds of taking an extra base (send). wind: drawn on the field.
export const CONDITIONS = Object.freeze({
  perfect: { label: 'Sunny and calm', blurb: 'A perfect fall morning.', ba: 1, xbh: 1, over: 1, err: 1, gap: 1, send: 0 },
  windOut: { label: 'Wind blowing out to right', blurb: 'Fly balls carry. The short porch in right gets shorter.', ba: 1, xbh: 1.08, over: 2.4, err: 1, gap: 1, send: 0, wind: 'out' },
  windIn: { label: 'Wind blowing in', blurb: 'Fly balls die. Almost nothing leaves the park.', ba: 0.99, xbh: 0.9, over: 0.3, err: 1, gap: 1, send: 0, wind: 'in' },
  wet: { label: 'Wet field after rain', blurb: 'Slick ball, soft grass: more errors, fewer extra bases, balls die before the gap.', ba: 1, xbh: 0.93, over: 0.8, err: 1.7, gap: 0.4, send: -0.07, wet: true },
  hot: { label: 'Hot and humid', blurb: 'The ball jumps off the bat.', ba: 1.01, xbh: 1.07, over: 1.5, err: 1, gap: 1, send: 0.02, tint: 'hot' },
  cold: { label: 'Cold and gray', blurb: 'Stinging hands and a heavy ball.', ba: 0.98, xbh: 0.92, over: 0.6, err: 1.25, gap: 1, send: -0.02, tint: 'cold' }
});
export const conditionsOf = (g) => CONDITIONS[g?.conditions] || CONDITIONS.perfect;
/** A random condition, sunny most often. */
export function randomConditions(random = Math.random) {
  const weights = { perfect: 4, windOut: 2, windIn: 2, wet: 1.5, hot: 1.5, cold: 1.5 };
  let r = random() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { r -= w; if (r <= 0) return k; }
  return 'perfect';
}

/** Feet from home to segment [p, q] along angle a (degrees, 0 = center, + toward right), or null. */
function rayTo(a, [p, q]) {
  const rad = (a * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = Math.cos(rad);
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = (p.x * ey - p.y * ex) / den;   // along the ray
  const s = (p.x * dy - p.y * dx) / den;   // along the segment, 0..1
  return t > 0 && s >= 0 && s <= 1 ? t : null;
}
const nearest = (a, segs) => segs.reduce((m, sg) => { const t = rayTo(a, sg); return t !== null && (m === null || t < m) ? t : m; }, null);

/** Feet to the fence along angle a, or null where there is none (open field, a gap). */
export const fenceAt = (a, pk = FIELD) => nearest(a, pk.fence);
/** Feet to the gap in the fence (Senior: right-center; Dreams: the hole in center) along angle a, or null. */
export const gapAt = (a, pk = FIELD) => (pk.gap ? rayTo(a, pk.gap) : null);
/** Feet to the dead-ball line (Senior: past the dugout; Dreams: the branch) along angle a, or null. */
export const deadAt = (a, pk = FIELD) => nearest(a, pk.dead || []);
/** Feet to the open right-field corner (Dreams) along angle a, or null. */
export const cornerAt = (a, pk = FIELD) => (pk.corner ? rayTo(a, pk.corner) : null);
const angleOf = (p) => (Math.atan2(p.x, p.y) * 180) / Math.PI;
const spanOf = (seg) => seg.map(angleOf).sort((a, b) => a - b);
/** How far a ball can go at angle a before the fence, a gap or a dead-ball spot. */
const deepAt = (a, pk = FIELD) => Math.min(fenceAt(a, pk) ?? Infinity, gapAt(a, pk) ?? Infinity, deadAt(a, pk) ?? Infinity, cornerAt(a, pk) ?? Infinity, 310);
/** Share of angles in [lo, hi] with fence (not a gap, not open) behind them. */
function fencedShare(lo, hi, pk = FIELD) {
  let n = 0;
  for (let i = 0; i < 60; i += 1) if (fenceAt(lo + ((hi - lo) * (i + 0.5)) / 60, pk) !== null) n += 1;
  return n / 60;
}

export function polar(a, r) {
  const rad = (a * Math.PI) / 180;
  return { x: Math.round(r * Math.sin(rad) * 10) / 10, y: Math.round(r * Math.cos(rad) * 10) / 10 };
}
export const spotXY = (slot, pk = FIELD) => {
  const s = pk.spots[slot];
  return slot === 'C' ? { x: 0, y: -7 } : polar(s.a, s.r);
};

// Where balls in play go, by fielder, for a right-handed batter (pulls to left).
const SPRAY_R = { P: 0.04, C: 0.02, '1B': 0.08, '2B': 0.1, SS: 0.14, '3B': 0.12, LF: 0.19, CF: 0.17, RF: 0.14 };
// (With four outfielders, balls to center go to left-center or right-center.)
const MIRROR = { '1B': '3B', '3B': '1B', '2B': 'SS', SS: '2B', LF: 'RF', RF: 'LF', P: 'P', C: 'C', CF: 'CF' };

function sprayFor(bats, powerZ) {
  const out = {};
  for (const s of SLOTS) {
    const base = bats === 'L' ? SPRAY_R[MIRROR[s]] : bats === 'R' ? SPRAY_R[s] : (SPRAY_R[s] + SPRAY_R[MIRROR[s]]) / 2;
    out[s] = base * (OF_ALL.includes(s) ? 1 + 0.08 * powerZ : 1);
  }
  return out;
}

function pickWeighted(weights, random) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (const [k, w] of Object.entries(weights)) { r -= w; if (r <= 0) return k; }
  return Object.keys(weights)[0];
}

const rnd = (random, lo, hi) => lo + random() * (hi - lo);

/** Outfielder who plays a ball hit at angle a (three or four of them out there), and how deep he plays. */
function ofAt(g, a) {
  const f = fieldingTeam(g).field;
  if (f.LCF || f.RCF) return a < -20 ? 'LF' : a < 0 ? 'LCF' : a <= 20 ? 'RCF' : 'RF';
  return a < -13 ? 'LF' : a > 13 ? 'RF' : 'CF';
}
const ofR = (g, a) => parkOf(g).spots[ofAt(g, a)].r;

// --- Teams ------------------------------------------------------------------

/**
 * A team ready to play.
 * @param {object} t { name, color, cpu, players: [pool player], lineup?: ids, field?: {slot:id}, plan?: [{slot:id}] }
 *   lineup can be longer than nine (everyone who shows up bats). plan is the
 *   fielding by inning (plan[0] = 1st inning; the last entry carries on into
 *   extra innings). A missing C is the courtesy catcher, who makes no plays.
 */
export function makeTeam({ name, color, cpu = false, players, lineup, field, plan = null }) {
  const roster = {};
  for (const p of players) {
    roster[p.id] = { id: p.id, name: p.name, team: p.team, bats: p.bats || '', pos: p.pos, ratings: { ...p.ratings } };
  }
  const box = Object.fromEntries(players.map((p) => [p.id, { ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, so: 0 }]));
  return {
    name, color, cpu,
    roster,
    lineup: lineup || battingOrder(players),
    field: plan?.length ? { ...plan[0] } : field || assignPositions(players),
    plan: plan?.length ? plan : null,
    box,
    pit: { outs: 0, r: 0, h: 0, bb: 0, so: 0, bf: 0, calls: 0 },
    runs: [],
    hits: 0,
    errors: 0,
    next: 0
  };
}

/** New game. away bats first. league: leagueSummary() (plain JSON). */
export function newGame({ away, home, league, conditions = 'perfect', park = 'senior' }) {
  return {
    v: 1,
    park: FIELDS[park] ? park : 'senior',
    league,
    conditions: CONDITIONS[conditions] ? conditions : 'perfect',
    teams: [away, home],
    inning: 1,
    half: 0,
    outs: 0,
    bases: [null, null, null],
    score: [0, 0],
    over: false,
    result: null,
    log: [],
    plays: 0
  };
}

export const battingTeam = (g) => g.teams[g.half];
export const fieldingTeam = (g) => g.teams[1 - g.half];
export const currentBatter = (g) => { const t = battingTeam(g); return t.roster[t.lineup[t.next % t.lineup.length]]; };
export const currentPitcher = (g) => { const t = fieldingTeam(g); return t.roster[t.field.P]; };
const fielderAt = (g, slot) => { const t = fieldingTeam(g); return t.roster[t.field[slot]]; };

const pitchEffect = (league) => clamp(0.5 * (league.scale.pitch.sd / league.scale.pitch.mean), 0.02, 0.07);

// The umpire: now and then a pitch is called a ball for being flat (no arc)
// or illegal (too high, bad delivery). About 6 a game from average pitchers,
// more from poor ones. For show only: walks already come from the league's rates.
export const CALLED_BALL_RATE = 0.062;
function umpireCalls(pitcher, random) {
  const p = clamp(CALLED_BALL_RATE * Math.exp(-0.3 * z(pitcher.ratings.pitch)), 0.015, 0.16);
  const calls = [];
  if (random() < p) {
    calls.push(random() < 0.6 ? 'flat' : 'illegal');
    if (random() < 0.15) calls.push(random() < 0.6 ? 'flat' : 'illegal');
  }
  return calls;
}

/** Probability the batter does each thing, before a ball is put in play. */
export function paOdds(g, batter = currentBatter(g), pitcher = currentPitcher(g)) {
  const L = g.league;
  const pz = z(pitcher.ratings.pitch);
  const bb = clamp(L.bb * (1 - 0.2 * pz), 0.01, 0.25);
  const k = clamp(L.k * (1 + 0.25 * pz), 0.003, 0.15);
  const cond = conditionsOf(g);
  const ba = clamp(rateFor('contact', batter.ratings.contact, L) * (1 - pitchEffect(L) * pz) * cond.ba, 0.12, 0.88);
  const xbh = clamp(rateFor('power', batter.ratings.power, L) * cond.xbh, 0.004, 0.55);
  return { bb, k, ba, xbh };
}

// --- Plan -------------------------------------------------------------------

/**
 * Roll one plate appearance. Changes nothing.
 * @returns play: {
 *   batter, pitcher, kind, contact, fielder, land:{x,y}, throwTo,
 *   decision: null | { runner, from, to, pSafe, label, auto: 'send'|'hold' },
 *   outcome  (when no decision) | options: { send, hold } (when there is one)
 * }  outcome = { moves: [{ id, from, to, out, how? }], text, rbi, earned }
 */
export function planPA(g, { random = Math.random } = {}) {
  const L = g.league;
  const batter = currentBatter(g);
  const pitcher = currentPitcher(g);
  const odds = paOdds(g, batter, pitcher);
  const r = random();
  const play = { batter: batter.id, pitcher: pitcher.id, kind: '', contact: null, fielder: null, land: null, throwTo: null, decision: null };
  play.calls = umpireCalls(pitcher, random);
  const bases = g.bases;
  const outs = g.outs;

  if (r < odds.bb) {
    play.kind = 'BB';
    play.outcome = forceOuts(g, batter, 'walks', { rbiOnForce: true });
    return play;
  }
  if (r < odds.bb + odds.k) {
    play.kind = 'K';
    play.fielder = 'C';
    play.outcome = { moves: [{ id: batter.id, from: 0, to: 0, out: true, how: 'k' }], text: `${batter.name} strikes out.`, rbi: 0 };
    return play;
  }

  // Ball in play: who is it hit at?
  const bz = { power: z(batter.ratings.power), speed: z(batter.ratings.speed), contact: z(batter.ratings.contact) };
  const PK = parkOf(g);
  const fld = fieldingTeam(g).field;
  let slot = pickWeighted(sprayFor(batter.bats, bz.power), random);
  // Four outfielders: a ball to center goes to left-center or right-center (lefties pull it right).
  if (slot === 'CF' && !fld.CF && (fld.LCF || fld.RCF)) slot = random() < (batter.bats === 'L' ? 0.6 : batter.bats === 'R' ? 0.4 : 0.5) ? 'RCF' : 'LCF';
  // Nobody there (the courtesy catcher can't make plays): someone else covers it.
  if (!fld[slot]) slot = pickWeighted({ P: 1, '1B': 1, '3B': 1 }, random);
  const F = fielderAt(g, slot);
  const fz = { range: z(F.ratings.range), arm: z(F.ratings.arm) };
  const rangeEffect = IF_SLOTS.includes(slot) ? 0.08 : OF_ALL.includes(slot) ? 0.06 : 0.03;
  const kOfAB = odds.k / (1 - odds.bb);
  const pHit = clamp((odds.ba * (1 - rangeEffect * fz.range)) / (1 - kOfAB), 0.05, 0.95);
  const isIF = !OF_ALL.includes(slot);
  const spot = PK.spots[slot];

  if (random() < pHit) {
    // ---- Hit
    const pXBH = clamp(odds.xbh / odds.ba, 0, 0.85);
    let kind = '1B';
    if (random() < pXBH) {
      const w = {
        HR: L.mix.hr * (1 + 0.45 * bz.power),
        '3B': L.mix.t * (1 + 0.6 * bz.speed),
        '2B': L.mix.d
      };
      kind = pickWeighted(Object.fromEntries(Object.entries(w).map(([k2, v]) => [k2, Math.max(0.001, v)])), random);
    }
    play.kind = kind;
    if (kind === 'HR') {
      // Pull side: righties to left, lefties to right.
      // Real home runs didn't go through a gap or into a dead-ball spot (those
      // are triples and doubles), so pick an angle clear of them.
      const [lo, hi] = batter.bats === 'L' ? [-25, 40] : batter.bats === 'R' ? [-35, 25] : [-35, 38];
      const blocked = (x) => gapAt(x, PK) !== null || deadAt(x, PK) !== null || cornerAt(x, PK) !== null;
      let a = rnd(random, lo, hi);
      for (let i = 0; i < 20 && blocked(a); i += 1) a = rnd(random, lo, hi);
      if (blocked(a)) a = -20;
      const fence = fenceAt(a, PK);
      const over = fence !== null && random() < Math.min(1, (PK.overShare * conditionsOf(g).over) / Math.max(fencedShare(lo, hi, PK), 0.05));
      play.fielder = ofAt(g, a);
      if (over) {
        play.contact = 'fly';
        play.land = polar(a, fence + rnd(random, 12, 40));
      } else {
        // Past the outfielder: rolls to the fence, or on into open left field.
        play.contact = 'line';
        play.insidePark = true;
        play.throwTo = 4;
        play.land = polar(a, Math.min(ofR(g, a) * rnd(random, 1.35, 1.55), deepAt(a, PK) - 5, 285));
      }
      play.outcome = homeRun(g, batter, { insidePark: !over, where: fieldWord(play.fielder) });
      return play;
    }
    if (kind === '3B' || kind === '2B') {
      play.contact = random() < 0.3 ? 'line' : 'fly';
      // Some triples (and at Field of Dreams a few doubles) are the automatic
      // triple through the gap / the hole in the center-field fence.
      const holeOdds = (kind === '3B' ? PK.tripleShare : PK.holeDoubles || 0) * conditionsOf(g).gap;
      if (PK.gap && random() < holeOdds) {
        const [g0, g1] = spanOf(PK.gap);
        const pad = Math.min(0.8, (g1 - g0) / 4);
        const a = rnd(random, g0 + pad, g1 - pad);
        play.kind = '3B';
        play.contact = 'ground';
        play.fielder = ofAt(g, a);
        play.land = polar(a, gapAt(a, PK) + rnd(random, 12, 24));
        play.dead = true;
        play.gap = true;
        play.banner = PK.tripleBanner;
        const moves = [];
        for (let b = 2; b >= 0; b -= 1) if (g.bases[b]) moves.push({ id: g.bases[b], from: b + 1, to: 4, out: false });
        moves.push({ id: batter.id, from: 0, to: 3, out: false });
        play.outcome = { moves, text: `${batter.name} ${PK.tripleText}.${scoredText(g, moves)}`, rbi: moves.length - 1, hit: true };
        return play;
      }
      const lines = random() < 0.35;
      const side = random() < 0.5 ? -1 : 1;
      let a = lines ? side * rnd(random, 36, 43) : side * rnd(random, 12, 22);
      // Field of Dreams: down the right-field line and through the open corner, a ground-rule double.
      if (kind === '2B' && PK.corner && lines && side > 0 && random() < PK.cornerOdds) {
        const [c0, c1] = spanOf(PK.corner);
        a = rnd(random, c0 + 0.2, c1 - 0.2);
        play.fielder = ofAt(g, a);
        play.land = polar(a, cornerAt(a, PK) + rnd(random, 8, 16));
        play.dead = true;
        play.grd = true;
        return groundRuleDouble(g, play, batter, PK.cornerText);
      }
      // Into the dead-ball spot (Senior: past the dugout, every time; Dreams: the branch, sometimes).
      if (deadAt(a, PK) !== null && (kind === '2B' || PK.deadOdds < 1) && random() < PK.deadOdds) {
        play.kind = '2B';
        play.fielder = PK.deadOdds < 1 ? ofAt(g, a) : 'LF';
        play.land = polar(a, deadAt(a, PK) + (PK.deadOdds < 1 ? rnd(random, 1, 4) : rnd(random, 10, 22)));
        play.dead = true;
        play.grd = true;
        play.branch = PK.deadOdds < 1;
        return groundRuleDouble(g, play, batter, PK.deadText);
      }
      // A triple can't go past the dugout at Senior Field (that's a ground-rule double).
      if (kind === '3B' && PK.deadOdds >= 1 && deadAt(a, PK) !== null) a = -rnd(random, 28, 35);
      const d = ofR(g, a) * (kind === '3B' ? rnd(random, 1.22, 1.38) : rnd(random, 1.06, 1.22));
      play.land = polar(a, Math.min(d, deepAt(a, PK) - (kind === '3B' ? 4 : 10)));
      play.fielder = ofAt(g, a);
      return extraBaseHit(g, play, batter, kind, random);
    }
    // Single
    const infieldHit = isIF && slot !== 'C' && random() < clamp(0.25 + 0.1 * bz.speed, 0.08, 0.5);
    if (infieldHit) {
      play.kind = '1B';
      play.contact = 'ground';
      play.fielder = slot;
      play.land = polar(spot.a + rnd(random, -8, 8), Math.max(30, spot.r + rnd(random, -5, 20)));
      play.throwTo = 1;
      play.infield = true;
      play.outcome = forceOuts(g, batter, 'beats it out for an infield single', { rbiOnForce: true, hit: true });
      return play;
    }
    let a;
    if (isIF) {
      // Through the hole or up the middle.
      const holes = { '1B': [22, 34], '2B': [3, 12], SS: [-12, -3], '3B': [-34, -22], P: [-5, 5], C: [-5, 5] }[slot];
      a = rnd(random, holes[0], holes[1]);
      play.contact = random() < 0.6 ? 'ground' : 'line';
    } else {
      a = spot.a + rnd(random, -10, 10);
      play.contact = random() < 0.5 ? 'line' : 'fly';
    }
    const ofSlot = ofAt(g, a);
    play.fielder = ofSlot;
    play.land = polar(a, PK.spots[ofSlot].r * rnd(random, 0.7, 0.9));
    return single(g, play, batter, ofSlot, random);
  }

  // ---- Not a hit: an out, or an error
  play.fielder = slot;
  const pErr = clamp((isIF ? 0.04 : 0.025) * (1 - 0.3 * fz.range) * conditionsOf(g).err, 0.005, 0.12);
  if (random() < pErr) {
    play.kind = 'E';
    play.contact = isIF ? 'ground' : 'fly';
    play.land = isIF ? polar(spot.a + rnd(random, -6, 6), spot.r) : polar(spot.a + rnd(random, -8, 8), spot.r + rnd(random, -20, 20));
    play.throwTo = isIF ? 1 : 2;
    const moves = [];
    const extra = isIF ? 1 : 2;
    for (let b = 2; b >= 0; b -= 1) {
      if (bases[b]) moves.push({ id: bases[b], from: b + 1, to: Math.min(4, b + 1 + extra), out: false });
    }
    moves.push({ id: batter.id, from: 0, to: extra, out: false });
    play.outcome = { moves, text: `${batter.name} reaches on an error by ${F.name} (${slot}).${scoredText(g, moves)}`, rbi: 0, error: true };
    return play;
  }

  if (slot === 'C') {
    play.kind = 'PO';
    play.contact = 'pop';
    // Foul, in front of the backstop and dugouts.
    const fx = (random() < 0.5 ? -1 : 1) * rnd(random, 8, 32);
    play.land = { x: fx, y: rnd(random, -6, Math.min(Math.abs(fx) - 3, 14)) };
    play.outcome = { moves: [{ id: batter.id, from: 0, to: 1, out: true, how: 'caught' }], text: `${batter.name} pops out to the catcher in foul ground.`, rbi: 0 };
    return play;
  }

  if (isIF) {
    const t = random();
    if (t < 0.17) {
      play.kind = 'PO';
      play.contact = 'pop';
      play.land = polar(spot.a + rnd(random, -8, 8), Math.max(25, spot.r - rnd(random, 5, 30)));
      play.outcome = { moves: [{ id: batter.id, from: 0, to: 1, out: true, how: 'caught' }], text: `${batter.name} pops out to ${posWord(slot)}.`, rbi: 0 };
      return play;
    }
    if (t < 0.3) {
      play.kind = 'LO';
      play.contact = 'line';
      play.land = polar(spot.a + rnd(random, -5, 5), spot.r);
      play.outcome = { moves: [{ id: batter.id, from: 0, to: 1, out: true, how: 'caught' }], text: `${batter.name} lines out to ${posWord(slot)}.`, rbi: 0 };
      return play;
    }
    play.contact = 'ground';
    play.land = polar(spot.a + rnd(random, -7, 7), spot.r + rnd(random, -12, 4));
    return groundBall(g, play, batter, slot, F, random);
  }

  // Outfield: fly or line out, maybe a tag-up.
  play.kind = random() < 0.8 ? 'FO' : 'LO';
  play.contact = play.kind === 'FO' ? 'fly' : 'line';
  const depth = rnd(random, -35, 35);
  const fa = spot.a + rnd(random, -9, 9);
  play.land = polar(fa, Math.min(spot.r + depth, deepAt(fa, PK) - 6));
  return flyOut(g, play, batter, slot, F, depth, random);
}

const posWord = (slot) => ({ P: 'the pitcher', C: 'the catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', LCF: 'left-center', CF: 'center', RCF: 'right-center', RF: 'right' }[slot]);
const fieldWord = (slot) => ({ LF: 'left', LCF: 'left-center', CF: 'center', RCF: 'right-center', RF: 'right' }[slot] || posWord(slot));
const nameOf = (g, id) => g.teams[0].roster[id]?.name || g.teams[1].roster[id]?.name || id;
const runnerOf = (g, id) => g.teams[0].roster[id] || g.teams[1].roster[id];

function scoredText(g, moves) {
  const scored = moves.filter((m) => !m.out && m.to === 4).map((m) => nameOf(g, m.id));
  if (!scored.length) return '';
  return ` ${listWords(scored)} ${scored.length === 1 ? 'scores' : 'score'}.`;
}
function outText(g, moves, batterId) {
  return moves.filter((m) => m.out && m.id !== batterId).map((m) => ` ${nameOf(g, m.id)} is out at ${baseWord(m.to)}.`).join('');
}
const baseWord = (b) => ['home', 'first', 'second', 'third', 'home'][b];
const listWords = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Batter to first, runners move up only when forced (walk, infield single). */
function forceOuts(g, batter, verb, { rbiOnForce = false, hit = false } = {}) {
  const b = g.bases;
  const moves = [{ id: batter.id, from: 0, to: 1, out: false }];
  if (b[0]) {
    moves.push({ id: b[0], from: 1, to: 2, out: false });
    if (b[1]) {
      moves.push({ id: b[1], from: 2, to: 3, out: false });
      if (b[2]) moves.push({ id: b[2], from: 3, to: 4, out: false });
    }
  }
  const rbi = rbiOnForce ? moves.filter((m) => m.to === 4).length : 0;
  return { moves, text: `${batter.name} ${verb}.${scoredText(g, moves)}`, rbi, hit };
}

function groundRuleDouble(g, play, batter, where = SENIOR.deadText) {
  const b = g.bases;
  const moves = [];
  if (b[2]) moves.push({ id: b[2], from: 3, to: 4, out: false });
  if (b[1]) moves.push({ id: b[1], from: 2, to: 4, out: false });
  if (b[0]) moves.push({ id: b[0], from: 1, to: 3, out: false });
  moves.push({ id: batter.id, from: 0, to: 2, out: false });
  play.outcome = {
    moves,
    text: `${batter.name} hits a ground-rule double, ${where}.${scoredText(g, moves)}`,
    rbi: moves.filter((m) => m.to === 4).length,
    hit: true
  };
  return play;
}

function homeRun(g, batter, { insidePark = false, where = '' } = {}) {
  const moves = [];
  for (let b = 2; b >= 0; b -= 1) if (g.bases[b]) moves.push({ id: g.bases[b], from: b + 1, to: 4, out: false });
  moves.push({ id: batter.id, from: 0, to: 4, out: false });
  const n = moves.length;
  const what = n === 4 ? 'grand slam' : n === 1 ? 'solo home run' : `${n}-run home run`;
  const text = insidePark
    ? `${batter.name} circles the bases: an inside-the-park ${what}!`
    : `${batter.name} hits a ${what} over the fence in ${where}!`;
  return { moves, text, rbi: n, hit: true, insidePark };
}

/** Chance a runner makes it, for an extra base on a hit or a tag-up. */
function sendOdds(base, runner, fielder, g, { slot, bonus = 0 }) {
  let p = base + 0.12 * z(runner.ratings.speed) - 0.1 * z(fielder.ratings.arm) + bonus + conditionsOf(g).send;
  if (g.outs === 2) p += 0.1; // running on contact
  if (slot === 'LF') p -= 0.04;
  if (slot === 'RF') p += 0.03;
  return clamp(p, 0.03, 0.98);
}

const SURE = 0.88;    // go without asking
const NO_WAY = 0.22;  // hold without asking
const cpuSends = (p, outs) => p >= (outs === 2 ? 0.45 : 0.6);

/**
 * Build a decision (or a settled outcome) for a lead runner on a close play.
 * runnerMove: the lead runner's base move; others: the rest (already settled).
 */
function withDecision(g, play, { runner, from, safeTo, holdTo, p, random, others, baseText, rbiBase, hit, holdOthers }) {
  const safe = random() < p;
  const build = (send) => {
    let moves;
    if (send) moves = [{ id: runner.id, from, to: safeTo, out: !safe }, ...others];
    else moves = [{ id: runner.id, from, to: holdTo, out: false }, ...(holdOthers || others)];
    const rbi = rbiBase + moves.filter((m) => !m.out && m.to === 4 && m.rbi !== false).length;
    let extra = '';
    if (send && safe && safeTo < 4) extra = ` ${runner.name} goes to ${baseWord(safeTo)}.`;
    if (!send && holdTo !== from) extra = ` ${runner.name} holds at ${baseWord(holdTo)}.`;
    const text = `${baseText}${scoredText(g, moves)}${outText(g, moves, play.batter)}${extra}`;
    return { moves, text, rbi, hit };
  };
  play.throwTo = safeTo;
  if (p >= SURE) { play.outcome = build(true); return play; }
  if (p <= NO_WAY) { play.throwTo = null; play.outcome = build(false); return play; }
  const user = !battingTeam(g).cpu;
  play.decision = {
    runner: runner.id,
    from, to: safeTo, holdTo,
    pSafe: Math.round(p * 100) / 100,
    label: `Send ${runner.name} ${safeTo === 4 ? 'home' : `to ${baseWord(safeTo)}`}?`,
    auto: cpuSends(p, g.outs) ? 'send' : 'hold',
    ask: user
  };
  play.options = { send: build(true), hold: build(false) };
  return play;
}

function single(g, play, batter, ofSlot, random) {
  const b = g.bases;
  const F = fielderAt(g, ofSlot);
  const base = `${batter.name} singles to ${fieldWord(ofSlot)}.`;
  const moves = [];
  if (b[2]) moves.push({ id: b[2], from: 3, to: 4, out: false });
  // Lead runner with a choice: from 2nd (score?) else from 1st (to third?)
  if (b[1]) {
    const runner = runnerOf(g, b[1]);
    const p = sendOdds(0.55, runner, F, g, { slot: ofSlot });
    const trail = [];
    if (b[0]) trail.push({ id: b[0], from: 1, to: 2, out: false });
    trail.push({ id: batter.id, from: 0, to: 1, out: false });
    const holdTrail = [];
    if (b[0]) holdTrail.push({ id: b[0], from: 1, to: 2, out: false });
    holdTrail.push({ id: batter.id, from: 0, to: 1, out: false });
    return withDecision(g, play, {
      runner, from: 2, safeTo: 4, holdTo: 3, p, random,
      others: [...moves, ...trail], holdOthers: [...moves, ...holdTrail],
      baseText: base, rbiBase: 0, hit: true
    });
  }
  if (b[0]) {
    const runner = runnerOf(g, b[0]);
    const p = sendOdds(0.32, runner, F, g, { slot: ofSlot, bonus: ofSlot === 'RF' ? 0.1 : ofSlot === 'LF' ? -0.1 : 0 });
    const bat = { id: batter.id, from: 0, to: 1, out: false };
    return withDecision(g, play, {
      runner, from: 1, safeTo: 3, holdTo: 2, p, random,
      others: [...moves, bat], baseText: base, rbiBase: 0, hit: true
    });
  }
  moves.push({ id: batter.id, from: 0, to: 1, out: false });
  play.outcome = { moves, text: `${base}${scoredText(g, moves)}`, rbi: moves.filter((m) => m.to === 4).length, hit: true };
  return play;
}

function extraBaseHit(g, play, batter, kind, random) {
  const b = g.bases;
  const F = fielderAt(g, play.fielder);
  const word = kind === '3B' ? 'triples' : 'doubles';
  const where = Math.abs(Math.atan2(play.land.x, play.land.y) * 180 / Math.PI) > 33 ? 'down the line' : 'into the gap';
  const base = `${batter.name} ${word} ${where} in ${fieldWord(play.fielder)}.`;
  const moves = [];
  if (b[2]) moves.push({ id: b[2], from: 3, to: 4, out: false });
  if (b[1]) moves.push({ id: b[1], from: 2, to: 4, out: false });
  if (kind === '3B') {
    if (b[0]) moves.push({ id: b[0], from: 1, to: 4, out: false });
    moves.push({ id: batter.id, from: 0, to: 3, out: false });
    play.outcome = { moves, text: `${base}${scoredText(g, moves)}`, rbi: moves.filter((m) => m.to === 4).length, hit: true };
    return play;
  }
  const bat = { id: batter.id, from: 0, to: 2, out: false };
  if (b[0]) {
    const runner = runnerOf(g, b[0]);
    const p = sendOdds(0.48, runner, F, g, { slot: play.fielder });
    return withDecision(g, play, {
      runner, from: 1, safeTo: 4, holdTo: 3, p, random,
      others: [...moves, bat], baseText: base, rbiBase: 0, hit: true
    });
  }
  moves.push(bat);
  play.outcome = { moves, text: `${base}${scoredText(g, moves)}`, rbi: moves.filter((m) => m.to === 4).length, hit: true };
  return play;
}

function groundBall(g, play, batter, slot, F, random) {
  const b = g.bases;
  const outs = g.outs;
  const bz = z(batter.ratings.speed);
  const where = posWord(slot);
  // Double play: runner on first, fewer than two outs.
  if (b[0] && outs < 2) {
    const pDP = clamp(0.48 - 0.1 * bz + 0.06 * z(F.ratings.arm) + (slot === 'SS' || slot === '2B' ? 0.05 : 0), 0.15, 0.8);
    if (random() < pDP) {
      play.kind = 'DP';
      play.throwTo = 2;
      play.relay = 1;
      const moves = [
        { id: b[0], from: 1, to: 2, out: true },
        { id: batter.id, from: 0, to: 1, out: true }
      ];
      if (outs === 0) {
        if (b[2]) moves.push({ id: b[2], from: 3, to: 4, out: false, rbi: false });
        if (b[1]) moves.push({ id: b[1], from: 2, to: 3, out: false });
      } else {
        if (b[2]) moves.push({ id: b[2], from: 3, to: 3, out: false });
        if (b[1]) moves.push({ id: b[1], from: 2, to: 2, out: false });
      }
      play.outcome = { moves, text: `${batter.name} grounds into a double play, ${slot === 'P' ? 'pitcher' : slot} to second to first.${scoredText(g, moves)}`, rbi: 0 };
      return play;
    }
    // Fielder's choice: lead force at second.
    if (random() < 0.35) {
      play.kind = 'FC';
      play.throwTo = 2;
      const moves = [{ id: b[0], from: 1, to: 2, out: true }, { id: batter.id, from: 0, to: 1, out: false }];
      if (b[1]) moves.push({ id: b[1], from: 2, to: 3, out: false });
      if (b[2]) moves.push({ id: b[2], from: 3, to: (outs + 1 < 3) ? 4 : 3, out: false });
      play.outcome = { moves, text: `${batter.name} reaches on a fielder's choice to ${where}.${outText(g, moves, batter.id)}${scoredText(g, moves)}`, rbi: moves.filter((m) => m.to === 4 && !m.out).length };
      return play;
    }
  }
  // Routine ground out to first; runners move up.
  play.kind = 'GO';
  play.throwTo = slot === '1B' ? null : 1;
  const moves = [{ id: batter.id, from: 0, to: 1, out: true }];
  if (outs + 1 < 3) {
    let thirdOpen = !b[2];
    if (b[2]) {
      const go = random() < clamp(0.45 + 0.1 * z(runnerOf(g, b[2]).ratings.speed) + (slot === '1B' || slot === '2B' ? 0.1 : 0), 0.1, 0.85);
      moves.push({ id: b[2], from: 3, to: go ? 4 : 3, out: false });
      thirdOpen = go;
    }
    if (b[1]) moves.push({ id: b[1], from: 2, to: thirdOpen ? 3 : 2, out: false });
    if (b[0]) moves.push({ id: b[0], from: 1, to: 2, out: false });
  }
  const verb = slot === 'P' ? 'grounds back to the pitcher' : `grounds out to ${where}`;
  play.outcome = { moves, text: `${batter.name} ${verb}.${scoredText(g, moves)}`, rbi: moves.filter((m) => m.to === 4 && !m.out).length };
  return play;
}

function flyOut(g, play, batter, slot, F, depth, random) {
  const b = g.bases;
  const verb = play.kind === 'FO' ? 'flies out' : 'lines out';
  const base = `${batter.name} ${verb} to ${fieldWord(slot)}.`;
  const out = { id: batter.id, from: 0, to: 1, out: true, how: 'caught' };
  if (play.kind === 'FO' && g.outs < 2 && b[2]) {
    const runner = runnerOf(g, b[2]);
    const p = sendOdds(0.62 + depth / 140, runner, F, g, { slot });
    const others = [out];
    if (b[1] && random() < clamp(0.25 + depth / 100 + (slot === 'RF' ? 0.15 : 0), 0, 0.7)) others.push({ id: b[1], from: 2, to: 3, out: false, tag: true });
    play.tag = true;
    play.kind = 'FO';
    const res = withDecision(g, play, {
      runner, from: 3, safeTo: 4, holdTo: 3, p, random,
      others, holdOthers: [out], baseText: base, rbiBase: 0, hit: false
    });
    if (res.outcome) markSac(res.outcome, runner.id);
    if (res.options) markSac(res.options.send, runner.id);
    return res;
  }
  const moves = [out];
  if (play.kind === 'FO' && g.outs < 2 && b[1] && !b[2] && depth > 5 && random() < 0.45 + (slot === 'RF' ? 0.2 : 0)) {
    moves.push({ id: b[1], from: 2, to: 3, out: false, tag: true });
  }
  play.outcome = { moves, text: `${base}${moves.length > 1 ? ` ${nameOf(g, b[1])} tags and goes to third.` : ''}`, rbi: 0 };
  return play;
}

function markSac(outcome, runnerId) {
  const m = outcome.moves.find((x) => x.id === runnerId);
  if (m && !m.out && m.to === 4) { outcome.sac = true; outcome.text = outcome.text.replace('flies out', 'hits a sacrifice fly'); }
}

// --- Commit -----------------------------------------------------------------

/**
 * Apply a planned play. choice: 'send' | 'hold' when play.decision is set
 * (defaults to the decision's auto answer). Returns the outcome used, with
 * runs scored and whether the half inning or game ended.
 */
export function commitPA(g, play, choice) {
  if (g.over) return null;
  const outcome = play.decision ? play.options[choice || play.decision.auto] : play.outcome;
  const bat = battingTeam(g);
  const fld = fieldingTeam(g);
  const box = bat.box[play.batter];
  const pit = fld.pit;
  const outsBefore = g.outs;
  const newOuts = outcome.moves.filter((m) => m.out).length;
  const outsAfter = outsBefore + newOuts;
  const endsInning = outsAfter >= 3;

  // Runs only count on an out play that ends the inning when they aren't
  // behind a force/batter out (keep it simple: out plays that end it score none).
  const outPlay = ['GO', 'DP', 'FC', 'FO', 'LO', 'PO', 'K'].includes(play.kind);
  const scorers = outcome.moves.filter((m) => !m.out && m.to === 4 && !(endsInning && outPlay));

  // Bases
  const moved = new Set(outcome.moves.map((m) => m.id));
  const bases = g.bases.map((id) => (id && !moved.has(id) ? id : null));
  if (!endsInning) {
    for (const m of outcome.moves) if (!m.out && m.to >= 1 && m.to <= 3) bases[m.to - 1] = m.id;
  }

  // Batting line
  pit.bf += 1;
  pit.calls = (pit.calls || 0) + (play.calls?.length || 0);
  const isAB = !(play.kind === 'BB' || outcome.sac);
  if (isAB) box.ab += 1;
  if (play.kind === 'BB') { box.bb += 1; pit.bb += 1; }
  if (play.kind === 'K') { box.so += 1; pit.so += 1; }
  if (outcome.hit) {
    box.h += 1; bat.hits += 1; pit.h += 1;
    if (play.kind === '2B') box.d += 1;
    if (play.kind === '3B') box.t += 1;
    if (play.kind === 'HR') box.hr += 1;
  }
  if (play.kind === 'E') fld.errors += 1;
  const runs = scorers.length;
  for (const m of scorers) bat.box[m.id].r += 1;
  box.rbi += Math.min(runs, outcome.rbi || 0);
  pit.r += runs;
  pit.outs += Math.min(newOuts, 3 - outsBefore);

  g.score[g.half] += runs;
  bat.runs[g.inning - 1] = (bat.runs[g.inning - 1] || 0) + runs;
  bat.next = (bat.next + 1) % bat.lineup.length;
  g.outs = Math.min(3, outsAfter);
  g.bases = bases;
  g.plays += 1;

  const called = (play.calls || []).map((c) => (c === 'flat' ? 'Flat pitch, ball.' : 'Illegal pitch, ball.')).join(' ');
  const text = (called ? `${called} ` : '') + outcome.text + (endsInning && outPlay && outcome.moves.some((m) => !m.out && m.to === 4) ? ' The inning ends before the run scores.' : '');
  const entry = { inning: g.inning, half: g.half, text, kind: play.kind, runs, score: [...g.score], outs: g.outs };
  g.log.push(entry);

  let ended = null;
  // Walk-off
  if (g.half === 1 && g.inning >= INNINGS && g.score[1] > g.score[0]) {
    ended = finish(g, 'walk-off');
  } else if (g.outs >= 3) {
    ended = endHalf(g);
  }
  return { outcome, runs, entry, endedHalf: g.outs === 0 || !!ended, ended };
}

function endHalf(g) {
  const team = battingTeam(g);
  team.runs[g.inning - 1] = team.runs[g.inning - 1] || 0;
  const lead = g.score[1] - g.score[0];
  if (g.half === 0) {
    // Home team leads after the top of the last inning (or later): no bottom half.
    if (g.inning >= INNINGS && lead > 0) return finish(g, 'final');
    for (const m of MERCY) if (g.inning - 1 >= m.after && lead >= m.lead) return finish(g, 'mercy');
    g.half = 1;
  } else {
    if (g.inning >= INNINGS && lead !== 0) return finish(g, 'final');
    for (const m of MERCY) if (g.inning >= m.after && Math.abs(lead) >= m.lead) return finish(g, 'mercy');
    if (g.inning >= MAX_INNINGS) return finish(g, 'tie');
    g.half = 0;
    g.inning += 1;
  }
  g.outs = 0;
  g.bases = [null, null, null];
  applyPlan(g);
  return null;
}

/** The team taking the field lines up the way its plan says for this inning. */
function applyPlan(g) {
  const t = fieldingTeam(g);
  if (t.plan?.length) t.field = { ...t.plan[Math.min(g.inning, t.plan.length) - 1] };
}

function finish(g, how) {
  g.over = true;
  g.outs = Math.min(g.outs, 3);
  const [a, h] = g.score;
  g.result = { how, winner: a === h ? null : a > h ? 0 : 1, innings: g.inning };
  // Ended after the top half: the home team's bottom half wasn't played (shows X).
  if (g.half === 0) g.teams[1].runs[g.inning - 1] = 'X';
  return g.result;
}

/** Play one plate appearance with automatic decisions. */
export function autoPA(g, opts) {
  const play = planPA(g, opts);
  return { play, ...commitPA(g, play) };
}

/** Sim the rest of the game with automatic decisions. */
export function simToEnd(g, opts) {
  let guard = 0;
  while (!g.over && guard < 2000) { autoPA(g, opts); guard += 1; }
  return g;
}

/** Sim to the end of the current half inning. */
export function simHalf(g, opts) {
  const { inning, half } = g;
  let guard = 0;
  while (!g.over && g.inning === inning && g.half === half && guard < 200) { autoPA(g, opts); guard += 1; }
  return g;
}

/** Innings pitched as baseball notation (5.1 = 5 1/3). */
export const ipText = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

/** Player of the game: most bases + RBI + runs, pitchers by fewest runs per out. */
export function starOfGame(g) {
  let best = null;
  g.teams.forEach((t, ti) => {
    for (const [id, b] of Object.entries(t.box)) {
      const tb = b.h + b.d + 2 * b.t + 3 * b.hr;
      const score = tb + b.bb * 0.5 + b.rbi * 1.2 + b.r * 0.8 + (g.result?.winner === ti ? 1 : 0);
      if (!best || score > best.score) best = { team: ti, id, name: t.roster[id].name, score, line: b };
    }
  });
  return best;
}
