// dfs-scoring.js
// Shared salary + fantasy-scoring math for Aces DFS.
//
// Pure functions only — no Firebase imports — so admin-dfs.html (salary
// generation + weekly scoring) and dfs.html (lineup builder + leaderboard)
// always agree on the numbers, and this can be reused from a Cloud Function
// later if the weekly cycle gets automated.
//
// TUNING: every point value / dollar amount lives in the named constants
// below. Change a number here and both the generator and the scorer pick
// it up automatically — no other file needs to change.

// ============================================================
// ROSTER SHAPE
// ============================================================

export const DFS_SLOTS = {
  IF: 4,
  OF: 3,
  C: 1,
  P: 1,
  UTIL: 1
};

export const ROSTER_SIZE = Object.values(DFS_SLOTS).reduce((a, b) => a + b, 0); // 10

// Real roster position values, from the captain roster editor's own
// dropdown (captain-roster-edit.html / admin-captain-roster-edit.html):
// ['-','P','C','1B','2B','3B','SS','IF','IF/OF','LF','CF','RF','OF','DH','UT','Flex']
// Captains often can't (or don't) pin a player to a specific LF/CF/RF/etc,
// so the generic 'IF' / 'OF' values are common in practice — those have to
// satisfy their DFS group too, not just the specific ones. 'IF/OF' means
// dual-eligible for both. 'DH'/'UT'/'Flex'/'-' have no fixed defensive
// group and stay UTIL-only, same as truly unset.
export const POSITION_GROUPS = {
  IF: ['1B', '2B', '3B', 'SS', 'IF'],
  OF: ['LF', 'CF', 'RF', 'OF'],
  C: ['C'],
  P: ['P']
};

/**
 * Normalize a roster position value into the DFS group(s) it satisfies.
 * Handles single values ('LF', 'IF', 'OF', ...) and slash-compound values
 * like 'IF/OF'. Case/whitespace-insensitive since roster data isn't
 * perfectly consistent. DH/UT/Flex/'-'/unset all return [] (no fixed
 * defensive group -> UTIL only).
 */
export function positionGroupsFor(position) {
  if (!position) return [];
  const parts = String(position).toUpperCase().split('/').map(s => s.trim()).filter(Boolean);
  const groups = [];
  parts.forEach(part => {
    if (POSITION_GROUPS.IF.includes(part) && !groups.includes('IF')) groups.push('IF');
    if (POSITION_GROUPS.OF.includes(part) && !groups.includes('OF')) groups.push('OF');
    if (POSITION_GROUPS.C.includes(part) && !groups.includes('C')) groups.push('C');
    if (POSITION_GROUPS.P.includes(part) && !groups.includes('P')) groups.push('P');
  });
  return groups;
}

/**
 * Which DFS slot(s) a player's real roster position can fill.
 * UTIL always works, in addition to any specific group(s) matched.
 */
export function eligibleSlotsForPosition(position) {
  return [...positionGroupsFor(position), 'UTIL'];
}

// ============================================================
// SALARY
// ============================================================

export const SALARY_CAP = 50000;
export const SALARY_MIN = 3000;
export const SALARY_MAX = 10000;
export const SALARY_STEP = 100;

// How much weight this season's acesBPI gets vs. career acesBPI, ramping
// up as the player accumulates games this season. Capped low on purpose —
// "slight adjustments... as current season data emerges," not a replacement
// for the career baseline.
export const CURRENT_SEASON_RAMP_GAMES = 10;   // full weight reached at this many games played this season
export const CURRENT_SEASON_MAX_WEIGHT = 0.25; // current season can never outweigh career by more than this

// A player with zero career acesBPI history (true rookie, no games yet
// anywhere) can't be percentile-ranked against the field, so they get a
// fixed near-floor salary instead. Flagged as "Unrated" in the UI.
export const ROOKIE_DEFAULT_SALARY = 3500;

// Pitchers are priced flat per league decision — acesBPI is a batting-only
// metric, so pricing the P slot off of it would really just be pricing
// "how well does this person hit," not "how well do they pitch." Flat
// salary means the P slot is a pure prediction bet, not a budget lever.
export const FLAT_PITCHER_SALARY = 5000;

/**
 * Blend career + current-season acesBPI into one "effective rating" used
 * for salary ranking. Returns null if the player has no acesBPI data at
 * all (career or current season) — caller should treat that as a rookie.
 *
 * @param {number|null|undefined} careerBPI
 * @param {number|null|undefined} currentSeasonBPI
 * @param {number} currentSeasonGames - games played THIS season (drives ramp)
 * @returns {number|null}
 */
export function effectiveRating(careerBPI, currentSeasonBPI, currentSeasonGames) {
  const hasCareer = isFiniteNumber(careerBPI);
  const hasCurrent = isFiniteNumber(currentSeasonBPI) && numOr0(currentSeasonGames) > 0;

  if (!hasCareer && !hasCurrent) return null;
  if (!hasCareer) return currentSeasonBPI;
  if (!hasCurrent) return careerBPI;

  const weight = Math.min(numOr0(currentSeasonGames) / CURRENT_SEASON_RAMP_GAMES, 1) * CURRENT_SEASON_MAX_WEIGHT;
  return careerBPI * (1 - weight) + currentSeasonBPI * weight;
}

/**
 * Convert a pool of { playerId, rating } into salaries by percentile rank
 * within the pool, scaled linearly across [SALARY_MIN, SALARY_MAX]. This
 * guarantees the full range gets used regardless of how acesBPI happens to
 * be distributed that week (robust to outliers, unlike a raw z-score map).
 *
 * Players with rating === null (no data) are priced at ROOKIE_DEFAULT_SALARY
 * and excluded from the percentile ranking of everyone else.
 *
 * Do NOT pass pitchers into this — they're priced flat by the caller
 * (see FLAT_PITCHER_SALARY) since this function only knows batting-based
 * ratings.
 *
 * @param {Array<{playerId: string, rating: number|null}>} players
 * @returns {Object<string, number>} playerId -> salary
 */
export function computeSalaries(players) {
  const salaries = {};
  const rated = players.filter(p => isFiniteNumber(p.rating));
  const unrated = players.filter(p => !isFiniteNumber(p.rating));

  unrated.forEach(p => { salaries[p.playerId] = ROOKIE_DEFAULT_SALARY; });

  if (rated.length === 0) return salaries;

  if (rated.length === 1) {
    salaries[rated[0].playerId] = roundToStep((SALARY_MIN + SALARY_MAX) / 2);
    return salaries;
  }

  const sorted = [...rated].sort((a, b) => a.rating - b.rating);
  sorted.forEach((p, i) => {
    const percentile = i / (sorted.length - 1); // 0 (worst) .. 1 (best)
    const raw = SALARY_MIN + percentile * (SALARY_MAX - SALARY_MIN);
    salaries[p.playerId] = roundToStep(raw);
  });

  return salaries;
}

function roundToStep(value) {
  return Math.round(value / SALARY_STEP) * SALARY_STEP;
}

// ============================================================
// FANTASY SCORING
// ============================================================

export const BATTING_POINTS = {
  single: 1,
  double: 2,
  triple: 3,
  homeRun: 4,
  run: 1,
  rbi: 1,
  walk: 1
};

// Only innings pitched + runs allowed are counted today — that's what the
// league reliably tracks per game. Wins/saves/strikeouts on a pitchingStats
// doc (if present) are intentionally ignored so scoring stays predictable.
export const PITCHING_POINTS = {
  perInning: 3,    // inningsPitched * this
  perRunAllowed: -1
};

/**
 * Score one game's batting line.
 *
 * Falls back to counting every hit as a single when doubles/triples/
 * homeRuns/rbi aren't populated (0 or missing) — the moment that data
 * starts flowing from submit-stats.html this season, games scored from
 * then on automatically get full extra-base-hit + RBI credit. No code
 * change needed when that happens.
 */
export function scoreBattingGame(stat) {
  if (!stat) return 0;
  const hits = numOr0(stat.hits);
  const doubles = numOr0(stat.doubles);
  const triples = numOr0(stat.triples);
  const homeRuns = numOr0(stat.homeRuns);
  const singles = Math.max(hits - doubles - triples - homeRuns, 0);
  const runs = numOr0(stat.runs);
  const rbi = numOr0(stat.rbi);
  const walks = numOr0(stat.walks);

  return (
    singles * BATTING_POINTS.single +
    doubles * BATTING_POINTS.double +
    triples * BATTING_POINTS.triple +
    homeRuns * BATTING_POINTS.homeRun +
    runs * BATTING_POINTS.run +
    rbi * BATTING_POINTS.rbi +
    walks * BATTING_POINTS.walk
  );
}

/** Score one game's pitching line (IP + runs allowed only — see PITCHING_POINTS). */
export function scorePitchingGame(stat) {
  if (!stat) return 0;
  const ip = numOr0(stat.inningsPitched);
  const runsAllowed = numOr0(stat.runsAllowed);
  return ip * PITCHING_POINTS.perInning + runsAllowed * PITCHING_POINTS.perRunAllowed;
}

/** Sum fantasy points across a list of game stat lines (all batting, or all pitching). */
export function sumGames(statLines, scoreFn) {
  return (statLines || []).reduce((total, stat) => total + scoreFn(stat), 0);
}

// ============================================================
// LINEUP VALIDATION
// ============================================================

/**
 * Validate a proposed 10-man lineup against slot requirements + salary cap.
 * @param {Array<{playerId: string, position: string, salary: number, slot: string}>} picks
 *   slot is the DFS slot (IF/OF/C/P/UTIL) the user assigned this player to.
 * @returns {{ valid: boolean, errors: string[], totalSalary: number }}
 */
export function validateLineup(picks) {
  const errors = [];
  const totalSalary = (picks || []).reduce((sum, p) => sum + numOr0(p.salary), 0);

  if (!picks || picks.length !== ROSTER_SIZE) {
    errors.push(`Roster must have exactly ${ROSTER_SIZE} players (has ${picks ? picks.length : 0}).`);
  }

  const ids = (picks || []).map(p => p.playerId);
  if (new Set(ids).size !== ids.length) {
    errors.push('The same player is in your lineup more than once.');
  }

  Object.entries(DFS_SLOTS).forEach(([slot, count]) => {
    const filled = (picks || []).filter(p => p.slot === slot).length;
    if (filled !== count) {
      errors.push(`${slot} needs ${count} player(s) — currently has ${filled}.`);
    }
  });

  (picks || []).forEach(p => {
    const eligible = eligibleSlotsForPosition(p.position);
    if (!eligible.includes(p.slot)) {
      errors.push(`${p.name || p.playerId} (${p.position || 'unknown position'}) isn't eligible for ${p.slot}.`);
    }
  });

  if (totalSalary > SALARY_CAP) {
    errors.push(`Over the salary cap by $${(totalSalary - SALARY_CAP).toLocaleString()}.`);
  }

  return { valid: errors.length === 0, errors, totalSalary };
}

// ============================================================
// HELPERS
// ============================================================

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function numOr0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
