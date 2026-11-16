// js/domain/pickem.js
// Pick'em rules, shared by pickem.html (js/pages/pickem.js). The Monday digest
// and pick reminders in functions/index.js follow the same rules (pickem*
// helpers there): keep the two in step.
//
// Scoring
//   1 point for a correct pick.
//   +1 upset bonus when you're right and fewer than a third of the pickers took
//   that team (at least 3 picks on the game).
//   Tie picks from TIE_FROM on (regular season only; playoffs have no time
//   limit): a correct tie is TIE_POINTS (1 + a 2-point tie bonus), and team
//   picks on a tied game miss. Before TIE_FROM a tie voids the game.
//   Forfeits, cancelled and postponed games count for no one.
//   A pick saved (server time) after first pitch doesn't count.
//   Standings: points, then correct picks, then fewest misses.
//
// Playoffs (double elimination, game docs playoff_g{n}): until a feeder game is
// decided, a later game names that side "G1 Winner" or "G2 Loser". Those games
// can still be picked. linkSlots() shows the slot as "Army/Teal Winner" and,
// once the feeder game is final, counts a "g1 winner" pick as the team that won
// it, even before the bracket page renames the game.
//
// Times: league times are Eastern. A game locks at its scheduled first pitch
// (8:00 AM that day when the time can't be read).

export const UPSET_SHARE = 1 / 3;
export const UPSET_MIN_PICKS = 3;
export const DEFAULT_LOCK_MINUTES = 8 * 60;
export const TIE_FROM = '2026-10-18';
export const TIE = 'tie';
export const TIE_POINTS = 3;
const TZ = 'America/New_York';

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

// ---------------------------------------------------------------------------
// Eastern dates and times
// ---------------------------------------------------------------------------

const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });

export function etParts(ms) {
  const p = {};
  etFmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month - 1, day: +p.day, h: +p.hour % 24, min: +p.minute };
}

/** Wall-clock Eastern time to epoch ms (two passes for DST changes). */
export function etToMs(y, m, day, h, min) {
  const guess = Date.UTC(y, m, day, h, min);
  const p = etParts(guess);
  const offset = Date.UTC(p.y, p.m, p.day, p.h, p.min) - guess;
  let ms = guess - offset;
  const p2 = etParts(ms);
  const offset2 = Date.UTC(p2.y, p2.m, p2.day, p2.h, p2.min) - ms;
  if (offset2 !== offset) ms = guess - offset2;
  return ms;
}

export function dateParts(g) {
  if (g.date && g.date.seconds) { const p = etParts(g.date.seconds * 1000); return { y: p.y, m: p.m, day: p.day }; }
  if (g.date && typeof g.date.toDate === 'function') { const p = etParts(g.date.toDate().getTime()); return { y: p.y, m: p.m, day: p.day }; }
  if (g.date && typeof g.date === 'string') {
    const parts = g.date.split(/[-/]/);
    if (parts.length < 3) return null;
    if (parts[0].length === 4) return { y: +parts[0], m: +parts[1] - 1, day: +parts[2] };
    return { y: +parts[2], m: +parts[0] - 1, day: +parts[1] };
  }
  return null;
}

export const dow = (dp) => new Date(Date.UTC(dp.y, dp.m, dp.day)).getUTCDay();
export const dpKey = (dp) => `${dp.y}-${String(dp.m + 1).padStart(2, '0')}-${String(dp.day).padStart(2, '0')}`;
export function addDays(dp, n) {
  const d = new Date(Date.UTC(dp.y, dp.m, dp.day + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

/** "7:45 PM" to minutes after midnight. No AM/PM: weekend 7-11 is morning, otherwise evening. */
export function timeToMinutes(t, dp) {
  if (!t) return null;
  const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]?/) || String(t).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3] ? m[3].toUpperCase() : null;
  if (h > 23 || min > 59) return null;
  if (period === 'A') { if (h === 12) h = 0; } else if (period === 'P') { if (h !== 12) h += 12; } else if (h < 12) {
    const weekend = dp && (dow(dp) === 0 || dow(dp) === 6);
    if (!(weekend && h >= 7)) h += 12;
  }
  return h * 60 + min;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export function normalizeGame(g) {
  const dp = dateParts(g);
  if (!dp) return null;
  const homeName = g.homeTeamName || cap(g.homeTeamId) || g['home team'] || 'TBD';
  const awayName = g.awayTeamName || cap(g.awayTeamId) || g['away team'] || 'TBD';
  const homeKey = String(g.homeTeamId || homeName).toLowerCase();
  const awayKey = String(g.awayTeamId || awayName).toLowerCase();
  const status = String(g.status || '').toLowerCase();
  const mins = timeToMinutes(g.time, dp);
  const lockMins = mins === null ? DEFAULT_LOCK_MINUTES : mins;
  const lockAt = etToMs(dp.y, dp.m, dp.day, Math.floor(lockMins / 60), lockMins % 60);
  const winnerRaw = g.winner ? String(g.winner).toLowerCase() : '';
  const homeScore = g.homeScore ?? g['home score'] ?? null;
  const awayScore = g.awayScore ?? g['away score'] ?? null;
  const isFinal = status === 'completed' || (!!winnerRaw && homeScore !== null && awayScore !== null);
  const isTBD = !!g.isPlaceholder || homeName === 'TBD' || awayName === 'TBD';
  const cancelled = ['cancelled', 'canceled', 'postponed', 'rainout', 'rained out'].includes(status);
  // submit-score writes the winner with spaces as underscores
  const same = (a, b) => a.replace(/[\s_]+/g, ' ') === b.replace(/[\s_]+/g, ' ');
  let winnerKey = null;
  if (isFinal && winnerRaw) {
    if (same(winnerRaw, homeKey) || same(winnerRaw, homeName.toLowerCase())) winnerKey = homeKey;
    else if (same(winnerRaw, awayKey) || same(winnerRaw, awayName.toLowerCase())) winnerKey = awayKey;
  }
  const isPlayoff = String(g.gameType || g.game_type || '').toLowerCase() === 'playoff';
  const tiesAllowed = dpKey(dp) >= TIE_FROM && !isPlayoff;
  const isTie = isFinal && !winnerKey && (winnerRaw === 'tie'
    || (homeScore !== null && awayScore !== null && homeScore !== '' && Number(homeScore) === Number(awayScore)));
  if (isTie && tiesAllowed && !g.forfeit) winnerKey = TIE;
  return {
    id: g.id, dp, time: g.time || '', lockAt, homeName, awayName, homeKey, awayKey,
    homeScore, awayScore, isFinal, isTBD, cancelled, isPlayoff, tiesAllowed, isTie,
    isForfeit: !!g.forfeit, winnerKey, slots: null,
    // void: final with no pick'em result (forfeit, unknown winner, a tie before TIE_FROM)
    isVoid: cancelled || (isFinal && (!winnerKey || !!g.forfeit))
  };
}

export const isLocked = (g, now = Date.now()) => now >= g.lockAt;
export const isGraded = (g) => g.isFinal && !g.isVoid;

const SLOT_RE = /^g(\d+)[\s_]+(winner|loser)$/;

/**
 * Playoff slots ("G1 Winner"): call once on the normalized season games.
 * A decided slot takes the team's key and name (so does a winner recorded as
 * the slot); an open one shows the feeder game's teams. Every game gets
 * g.slots ('g1 winner' -> { key, name }) for pickKey().
 */
export function linkSlots(games) {
  const byNum = new Map();
  games.forEach((g) => { const m = String(g.id).match(/^playoff_g(\d+)$/); if (m) byNum.set(Number(m[1]), g); });
  const slots = new Map();
  const real = (g) => !g.isTBD && !SLOT_RE.test(g.homeKey) && !SLOT_RE.test(g.awayKey);
  const fix = (g, side) => {
    const m = g[`${side}Key`].match(SLOT_RE);
    if (!m) return;
    const hit = slots.get(`g${m[1]} ${m[2]}`);
    if (hit) {
      if (g.winnerKey === g[`${side}Key`]) g.winnerKey = hit.key;
      g[`${side}Key`] = hit.key;
      g[`${side}Name`] = hit.name;
      return;
    }
    const src = byNum.get(Number(m[1]));
    if (src && real(src)) g[`${side}Name`] = `${src.awayName}/${src.homeName} ${m[2] === 'winner' ? 'Winner' : 'Loser'}`;
  };
  // Feeder games always have lower numbers, so one pass in order settles chains.
  [...byNum.keys()].sort((a, b) => a - b).forEach((n) => {
    const g = byNum.get(n);
    fix(g, 'home');
    fix(g, 'away');
    if (isGraded(g) && g.winnerKey !== TIE) {
      const homeWon = g.winnerKey === g.homeKey;
      slots.set(`g${n} winner`, { key: g.winnerKey, name: homeWon ? g.homeName : g.awayName });
      slots.set(`g${n} loser`, { key: homeWon ? g.awayKey : g.homeKey, name: homeWon ? g.awayName : g.homeName });
    }
  });
  games.forEach((g) => { g.slots = slots; });
  return games;
}

/** A saved pick as this game's key now: a "g1 winner" pick becomes G1's winner once it's final. */
export const pickKey = (g, team) => g.slots?.get(team)?.key || team;

// ---------------------------------------------------------------------------
// Picks and scoring. entries: { uid: { displayName, picks: { gameId: { team, atMs } } } }
// ---------------------------------------------------------------------------

export function validPick(entries, uid, g) {
  const p = entries[uid]?.picks?.[g.id];
  if (!p || !p.team) return null;
  if (p.atMs && p.atMs > g.lockAt) return null;
  const t = pickKey(g, p.team);
  if (t !== g.homeKey && t !== g.awayKey && !(t === TIE && g.tiesAllowed)) return null;
  return t;
}

export function splitFor(entries, g) {
  let home = 0, away = 0, tie = 0;
  Object.keys(entries).forEach((uid) => {
    const t = validPick(entries, uid, g);
    if (t === g.homeKey) home++;
    else if (t === g.awayKey) away++;
    else if (t === TIE) tie++;
  });
  return { home, away, tie, total: home + away + tie };
}

export function isUpset(entries, g) {
  if (!isGraded(g) || g.winnerKey === TIE) return false;   // a tie has its own bonus
  const s = splitFor(entries, g);
  if (s.total < UPSET_MIN_PICKS) return false;
  const winners = g.winnerKey === g.homeKey ? s.home : s.away;
  return winners / s.total < UPSET_SHARE;
}

/** Points for one pick on a graded game: { pts, bonus: 'tie' | 'upset' | '' } (0 for a miss). */
export function pickPoints(entries, g, team) {
  if (!isGraded(g) || team !== g.winnerKey) return { pts: 0, bonus: '' };
  if (team === TIE) return { pts: TIE_POINTS, bonus: 'tie' };
  return isUpset(entries, g) ? { pts: 2, bonus: 'upset' } : { pts: 1, bonus: '' };
}

/** Standings over a list of games: rows sorted by points, correct, fewest misses, name. */
export function scoreGames(entries, gameList) {
  const table = {};
  const ensure = (uid) => table[uid] || (table[uid] = { uid, name: entries[uid]?.displayName || 'Unknown', pts: 0, correct: 0, wrong: 0, bonuses: 0, picks: 0 });
  const upset = new Map();
  gameList.forEach((g) => {
    Object.keys(entries).forEach((uid) => {
      const t = validPick(entries, uid, g);
      if (!t) return;
      const row = ensure(uid);
      row.picks++;
      if (!isGraded(g)) return;
      if (t !== g.winnerKey) { row.wrong++; return; }
      row.correct++;
      if (t === TIE) { row.pts += TIE_POINTS; row.bonuses++; return; }
      if (!upset.has(g.id)) upset.set(g.id, isUpset(entries, g));
      row.pts += 1;
      if (upset.get(g.id)) { row.pts += 1; row.bonuses++; }
    });
  });
  const rows = Object.values(table).filter((r) => r.picks > 0)
    .sort((a, b) => (b.pts - a.pts) || (b.correct - a.correct) || (a.wrong - b.wrong) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.rank = p && p.pts === r.pts && p.correct === r.correct && p.wrong === r.wrong ? p.rank : i + 1;
  });
  return rows;
}

/** Sunday-start weeks, numbered from the first week with games. */
export function buildWeeks(games) {
  const map = new Map();
  games.forEach((g) => {
    const start = addDays(g.dp, -dow(g.dp));
    const key = dpKey(start);
    if (!map.has(key)) map.set(key, { key, start, games: [] });
    map.get(key).games.push(g);
  });
  const weeks = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  weeks.forEach((w, i) => { w.num = i + 1; w.allPlayoff = w.games.every((g) => g.isPlayoff); });
  return weeks;
}
